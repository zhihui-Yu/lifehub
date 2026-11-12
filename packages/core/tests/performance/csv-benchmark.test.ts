/**
 * CSV 解析性能基准。
 *
 * 覆盖需求：NF-P-1（10 万行 / 10MB 解析 ≤ 3s）。
 *
 * 说明：基准在 CI 的性能 job 中运行；这里用较小的行数保证本地测试不会超时，
 * 但仍然断言「解析速度不低于阈值」，便于回归检测。
 */
import { describe, expect, it } from 'vitest';
import { CsvParser } from '../../src/csv/parser';

/** 生成指定行数的 CSV 文本。 */
function buildCsv(rows: number): string {
  const lines: string[] = ['交易时间,交易对方,收/支,金额(元),备注'];
  for (let index = 0; index < rows; index += 1) {
    const day = (index % 28) + 1;
    const hour = (index % 24).toString().padStart(2, '0');
    lines.push(
      `2024-01-${day.toString().padStart(2, '0')} ${hour}:00:00,商户${index},支出,${(index % 900) + 1}.50,备注${index}`,
    );
  }
  return lines.join('\n');
}

describe('CSV 解析性能', () => {
  it('1 万行解析耗时低于 1s（NF-P-1 基准的 1/10 规模）', () => {
    const parser = new CsvParser();
    const text = buildCsv(10_000);
    const started = performance.now();
    const table = parser.parse(text);
    const elapsed = performance.now() - started;

    expect(table.rows).toHaveLength(10_000);
    expect(elapsed).toBeLessThan(1000);
  });

  it('10 万行解析耗时低于 3s（NF-P-1）', () => {
    const parser = new CsvParser();
    const text = buildCsv(100_000);
    const started = performance.now();
    const table = parser.parse(text);
    const elapsed = performance.now() - started;

    expect(table.rows).toHaveLength(100_000);
    expect(elapsed).toBeLessThan(3000);
  });

  it('流式解析 10 万行的耗时同样低于 3s', async () => {
    const parser = new CsvParser();
    const text = buildCsv(100_000);

    async function* chunks(): AsyncGenerator<string> {
      const size = 64 * 1024;
      for (let index = 0; index < text.length; index += size) {
        yield text.slice(index, index + size);
      }
    }

    const started = performance.now();
    let count = 0;
    for await (const row of parser.parseStream(chunks())) {
      if (row) count += 1;
    }
    const elapsed = performance.now() - started;

    expect(count).toBe(100_000);
    expect(elapsed).toBeLessThan(3000);
  });
});
