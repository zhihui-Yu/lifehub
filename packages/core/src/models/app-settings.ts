/**
 * 应用设置与后续阶段预留模型。
 *
 * 架构位置：core 包的领域模型层。
 *
 * 说明：`AppSettings` 明文存储（PRD §3.1「明文可接受」），
 * 因为解锁前就需要读取 timezone / theme / locale；
 * 其余模型（课表 / 习惯 / 日记 / AI 请求）本轮只落地类型定义，
 * 业务逻辑排期见 docs/roadmap.md（系统设计 §1.1「不在本轮范围」）。
 */
import { CurrencyCode } from '../money/currency';
import type { BaseEntity } from '../types/common';

/** 主题模式。 */
export type ThemeMode = 'light' | 'dark' | 'system';

/** 一周起始日（0 = 周日，1 = 周一）。 */
export type WeekStart = 0 | 1;

/** 应用设置。 */
export interface AppSettings {
  /** 固定 id，本地仅一份设置。 */
  id: 'default';
  /** 默认时区 IANA 名。 */
  timezone: string;
  /** 默认币种。 */
  currency: CurrencyCode;
  /** 主题模式。 */
  theme: ThemeMode;
  /** 一周起始日。 */
  weekStart: WeekStart;
  /** 界面语言标识。 */
  locale: string;
  /** 本机设备 id（本地生成的 UUID，**不是**硬件设备号）。 */
  deviceId: string;
  /** 首次使用时间，ISO 8601 UTC。 */
  createdAt: string;
  /** 最后更新时间，ISO 8601 UTC。 */
  updatedAt: string;
}

/** 课表时段（阶段 4 预留）。 */
export interface ScheduleSlot extends BaseEntity {
  /** 时段标题。 */
  title: string;
  /** 星期几，1 = 周一 … 7 = 周日。 */
  weekday: number;
  /** 开始墙钟时间 'HH:mm'。 */
  startTime: string;
  /** 结束墙钟时间 'HH:mm'。 */
  endTime: string;
  /** 地点。 */
  location: string;
  /** 课表颜色 '#RRGGBB'。 */
  color: string;
  /** 是否为完成确认事件（与习惯共享 CompletionEvent）。 */
  requiresCompletion: boolean;
}

/** 微习惯（阶段 4 预留）。 */
export interface Habit extends BaseEntity {
  /** 习惯名称。 */
  name: string;
  /** 习惯图标名。 */
  icon: string;
  /** 颜色 '#RRGGBB'。 */
  color: string;
  /** 目标频次描述，如 '每天'。 */
  targetFrequency: string;
  /** 是否为系统预置。 */
  isSystem: boolean;
}

/** 习惯打卡记录（阶段 4 预留）。 */
export interface HabitCheckIn extends BaseEntity {
  /** 所属习惯 id。 */
  habitId: string;
  /** 打卡日历日 'YYYY-MM-DD'。 */
  localDate: string;
  /** 完成时间，ISO 8601 UTC。 */
  completedAt: string;
}

/** 完成事件（课表与习惯共享，阶段 4 预留）。 */
export interface CompletionEvent extends BaseEntity {
  /** 来源类型。 */
  sourceType: 'scheduleSlot' | 'habit';
  /** 来源实体 id。 */
  sourceId: string;
  /** 发生日历日 'YYYY-MM-DD'。 */
  localDate: string;
  /** 完成时间，ISO 8601 UTC。 */
  completedAt: string;
}

/** 日记条目（阶段 6 预留，全字段加密存储）。 */
export interface DiaryEntry extends BaseEntity {
  /** 日记标题。 */
  title: string;
  /** 日记正文。 */
  body: string;
  /** 发生日历日 'YYYY-MM-DD'。 */
  localDate: string;
  /** 标签列表。 */
  tags: string[];
  /** 心情标记。 */
  mood: string | null;
  /** 是否置顶。 */
  isPinned: boolean;
}

/** AI 分析请求记录（阶段 6 预留，**只存指标不存明文**，X-13）。 */
export interface AIAnalysisRequest extends BaseEntity {
  /** 请求的载荷摘要 sha256 hex。 */
  payloadDigest: string;
  /** provider 标识，如 'openai-compatible'。 */
  provider: string;
  /** 模型名。 */
  model: string;
  /** 消耗 token 数。 */
  tokensUsed: number;
  /** 延迟（毫秒）。 */
  latencyMs: number;
  /** 是否成功。 */
  success: boolean;
}
