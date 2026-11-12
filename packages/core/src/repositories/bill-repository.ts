/**
 * 账单仓储。
 *
 * 架构位置：core 包的「仓储」层。核心层只通过仓储访问数据，**不感知 IndexedDB / Dexie**。
 */
import type { Bill, Direction } from '../models/bill';
import { validateBill } from '../models/bill';
import type { EncryptedStore } from '../storage/encrypted-store';
import type { DekProvider } from '../types/common';

/** 账单查询条件。 */
export interface BillQuery {
  /** 关键词，匹配 counterparty / note（解密后过滤）。 */
  keyword?: string;
  /** 方向过滤。 */
  directions?: Direction[];
  /** 日期区间起点 'YYYY-MM-DD'。 */
  dateFrom?: string;
  /** 日期区间终点 'YYYY-MM-DD'。 */
  dateTo?: string;
  /** 分类 id 过滤。 */
  categoryId?: string;
  /** 排序字段。 */
  orderBy?: 'occurredAt' | 'amountMinor' | 'createdAt';
  /** 排序方向。 */
  order?: 'asc' | 'desc';
  /** 返回条数上限。 */
  limit?: number;
  /** 跳过的条数。 */
  offset?: number;
}

/**
 * 账单仓储。
 *
 * 说明：日期区间与排序在存储层用索引明文列完成（先裁剪再解密），
 * 关键词 / 方向 / 分类过滤在解密后的内存工作集上完成（系统设计 §5 假设 A-8）。
 */
export class BillRepository {
  /** 加密存储门面。 */
  private readonly store: EncryptedStore;
  /** 密钥供给器。 */
  private readonly dek: DekProvider;

  /**
   * 构造账单仓储。
   *
   * @param deps 依赖集合
   */
  constructor(deps: { store: EncryptedStore; dek: DekProvider }) {
    this.store = deps.store;
    this.dek = deps.dek;
  }

  /**
   * 按条件列出账单。
   *
   * @param query 查询条件
   * @returns 账单列表
   * @throws {LifeHubError} `LIFEHUB_E_VAULT_NOT_FOUND` —— 未解锁
   */
  async list(query?: BillQuery): Promise<Bill[]> {
    const filter = {
      localDateFrom: query?.dateFrom,
      localDateTo: query?.dateTo,
      limit: query?.limit,
      offset: query?.offset,
      orderBy: query?.orderBy
        ? { column: query.orderBy as 'occurredAt' | 'createdAt' | 'updatedAt', direction: query.order ?? 'desc' }
        : undefined,
    };
    const bills = await this.store.query<Bill>('bill', filter);
    return this.applySemanticFilters(bills, query);
  }

  /**
   * 按 id 取账单。
   *
   * @param id 账单 id
   * @returns 账单；不存在返回 null
   */
  async getById(id: string): Promise<Bill | null> {
    const bill = await this.store.get<Bill>('bill', id);
    return bill ? validateBill(bill) : null;
  }

  /**
   * 写入一个账单。
   *
   * @param bill 账单实体
   * @returns 无异常
   * @throws {LifeHubError} `LIFEHUB_E_VALIDATION` —— 账单字段非法
   */
  async put(bill: Bill): Promise<void> {
    const validated = validateBill(bill);
    await this.store.put('bill', validated as unknown as Record<string, unknown>, {
      localDate: validated.localDate,
      occurredAt: validated.occurredAt,
    });
  }

  /**
   * 批量写入账单。
   *
   * @param bills 账单列表
   * @returns 无异常
   */
  async putMany(bills: readonly Bill[]): Promise<void> {
    if (bills.length === 0) {
      return;
    }
    const validated = bills.map((bill) => validateBill(bill));
    await this.store.putMany(
      'bill',
      validated as unknown as Record<string, unknown>[],
      (bill) => {
        const source = bill as unknown as Bill;
        return { localDate: source.localDate, occurredAt: source.occurredAt };
      },
    );
  }

  /**
   * 按本地日历日区间查询账单。
   *
   * @param from 起始日 'YYYY-MM-DD'
   * @param to 结束日 'YYYY-MM-DD'
   * @returns 账单列表
   */
  async queryByLocalDateRange(from: string, to: string): Promise<Bill[]> {
    return this.store.query<Bill>('bill', { localDateFrom: from, localDateTo: to });
  }

  /**
   * 统计指定方向的账单数。
   *
   * @param direction 收支方向
   * @returns 账单数
   */
  async countByDirection(direction: Direction): Promise<number> {
    const bills = await this.store.query<Bill>('bill');
    return bills.filter((bill) => bill.direction === direction).length;
  }

  /**
   * 删除一个账单。
   *
   * @param id 账单 id
   * @returns 无异常
   */
  async delete(id: string): Promise<void> {
    await this.store.delete('bill', id);
  }

  /**
   * 按导入批次 ID 删除该批次关联的全部账单。
   *
   * 说明：用于按导入文件批次撤销/删除已导入的账单，或覆盖重导同一文件前清理旧批次账单。
   *
   * @param sourceFileId 导入批次 ID（对应 `Bill.sourceFileId`）
   * @returns 实际删除的账单条数
   * @throws {LifeHubError} `LIFEHUB_E_VAULT_NOT_FOUND` —— 保险库未解锁时抛出
   */
  async deleteBySourceFileId(sourceFileId: string): Promise<number> {
    const bills = await this.store.query<Bill>('bill');
    const matched = bills.filter((bill) => bill.sourceFileId === sourceFileId);
    for (const bill of matched) {
      await this.store.delete('bill', bill.id);
    }
    return matched.length;
  }

  /**
   * 清空全部账单记录。
   *
   * 说明：逐条从加密存储中移除当前所有账单记录，用于用户主动清空账单列表后重新导入。
   *
   * @returns 实际删除的账单总条数
   * @throws {LifeHubError} `LIFEHUB_E_VAULT_NOT_FOUND` —— 保险库未解锁时抛出
   */
  async clearAll(): Promise<number> {
    const bills = await this.store.query<Bill>('bill');
    for (const bill of bills) {
      await this.store.delete('bill', bill.id);
    }
    return bills.length;
  }

  /**
   * 在解密后的结果上做语义过滤与排序。
   *
   * 说明：关键词 / 方向 / 分类属于业务语义，**不能**做成明文索引列，
   * 因此只能在内存工作集上过滤（ADR-006）。
   *
   * @param bills 已解密的账单列表
   * @param query 查询条件
   * @returns 过滤与排序后的账单列表
   */
  private applySemanticFilters(bills: Bill[], query?: BillQuery): Bill[] {
    let out = bills;
    if (query?.keyword) {
      const keyword = query.keyword.trim().toLowerCase();
      if (keyword !== '') {
        out = out.filter(
          (bill) =>
            bill.counterparty.toLowerCase().includes(keyword) || bill.note.toLowerCase().includes(keyword),
        );
      }
    }
    if (query?.directions && query.directions.length > 0) {
      const allowed = new Set(query.directions);
      out = out.filter((bill) => allowed.has(bill.direction));
    }
    if (query?.categoryId) {
      out = out.filter((bill) => bill.categoryId === query.categoryId);
    }
    if (query?.orderBy) {
      const factor = query.order === 'asc' ? 1 : -1;
      out = [...out].sort((a, b) => {
        const left = a[query.orderBy as 'occurredAt' | 'amountMinor' | 'createdAt'];
        const right = b[query.orderBy as 'occurredAt' | 'amountMinor' | 'createdAt'];
        if (left === right) {
          return 0;
        }
        return (left < right ? -1 : 1) * factor;
      });
    }
    return out;
  }
}
