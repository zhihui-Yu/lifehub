/**
 * 安全深度验证 · X-10 密钥轮换（接口与数据结构层）。
 *
 * 覆盖需求：X-10；系统设计 §1.2 难点 6（密钥轮换模型）；ADR-003 §1（主密钥只做包裹）。
 * 覆盖红线：R4（唯一密文写通道）。
 *
 * 【本轮交付边界】
 * 系统设计 §1.2 难点 6 与 §7 T02 明确：本轮（Sprint 0）**只落接口 + 参数校验 + 轮换计划**，
 * 完整的「重包裹 DEK + 逐条重加密存量密文 + 可中断续跑 + 旧密钥销毁」排期在阶段 5。
 * 因此本文件**不**断言「轮换后数据仍可解」这类尚未实现的行为，
 * 只断言**本轮确实交付了**的部分：
 * 1. `rotateMasterKey` 的参数校验（旧口令错 / 新口令太短 / 新旧口令相同）；
 * 2. `RotationPlan`（代码中名为 `KeyRotationPlan`）的数据结构完整性；
 * 3. `keyVersion` 的**递增语义**（toKeyVersion = fromKeyVersion + 1）；
 * 4. `KeyRotationService` 的状态机结构与「未实现」时的错误码契约。
 */
import { describe, expect, it } from 'vitest';
import { createTestRuntime } from '../helpers/runtime';
import { KeyRotationService } from '../../src/services/key-rotation-service';
import type { KeyRotationPlan, RotationState, RotationStatus } from '../../src/services/key-rotation-service';

/** 测试用主口令。 */
const PASSWORD = 'test-password-123';

/**
 * 涉及建库 / 解锁（真实 scrypt）的用例超时上限。
 *
 * 说明：覆盖率插桩 + 多 worker 并行时，单次 scrypt 可能耗时数十秒，
 * 这里给足余量；**这只放宽超时上限，不放宽任何断言**。
 */
const VAULT_TIMEOUT = 180_000;

/** 测试运行时类型别名。 */
type Runtime = ReturnType<typeof createTestRuntime>;

/**
 * 断言对象是一个合法的轮换计划。
 *
 * @param plan 待断言的轮换计划
 * @returns 无
 */
function assertPlanShape(plan: KeyRotationPlan): void {
  expect(typeof plan.jobId).toBe('string');
  expect(plan.jobId.length).toBeGreaterThan(0);
  expect(plan.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(Number.isInteger(plan.fromKeyVersion)).toBe(true);
  expect(Number.isInteger(plan.toKeyVersion)).toBe(true);
  expect(typeof plan.reason).toBe('string');
  expect(plan.reason.length).toBeGreaterThan(0);
  expect(Number.isInteger(plan.estimatedRecords)).toBe(true);
  expect(plan.estimatedRecords).toBeGreaterThanOrEqual(0);
}

describe('X-10 · rotateMasterKey 的参数校验', () => {
  it('旧口令错误时抛 LIFEHUB_E_VAULT_PASSWORD_WRONG', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault(PASSWORD);

    await expect(runtime.vault.rotateMasterKey('wrong-old-password', 'new-password-456')).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VAULT_PASSWORD_WRONG' }),
    );
  }, VAULT_TIMEOUT);

  it('新口令长度不足时抛 LIFEHUB_E_VALIDATION', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault(PASSWORD);

    await expect(runtime.vault.rotateMasterKey(PASSWORD, 'short')).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
  }, VAULT_TIMEOUT);

  it('新旧口令相同时抛 LIFEHUB_E_VALIDATION', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault(PASSWORD);

    await expect(runtime.vault.rotateMasterKey(PASSWORD, PASSWORD)).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_VALIDATION' }),
    );
  }, VAULT_TIMEOUT);

  it('参数校验失败时不会产生任何轮换副作用（不落盘新 DEK）', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault(PASSWORD);
    const before = await runtime.vaultRepository.load();

    await expect(runtime.vault.rotateMasterKey(PASSWORD, 'short')).rejects.toThrow();

    const after = await runtime.vaultRepository.load();
    expect(after?.keyVersion).toBe(before?.keyVersion);
    expect(after?.currentDek.wrapped.ciphertext).toEqual(before?.currentDek.wrapped.ciphertext);
  }, VAULT_TIMEOUT);
});

describe('X-10 · RotationPlan 数据结构与 keyVersion 递增语义', () => {
  it('rotateMasterKey 返回结构完整的轮换计划', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault(PASSWORD);

    const plan = await runtime.vault.rotateMasterKey(PASSWORD, 'new-password-456');

    assertPlanShape(plan);
    expect(plan.reason).toBe('rotate-master-key');
    expect(plan.fromKeyVersion).toBe(1);
    expect(plan.toKeyVersion).toBe(2);
  }, VAULT_TIMEOUT);

  it('keyVersion 严格递增：toKeyVersion = fromKeyVersion + 1', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault(PASSWORD);

    const plan = await runtime.vault.rotateMasterKey(PASSWORD, 'new-password-456');
    expect(plan.toKeyVersion).toBe(plan.fromKeyVersion + 1);
  }, VAULT_TIMEOUT);

  it('KeyRotationService.planRotation 同样遵循 +1 递增语义', async () => {
    const service = new KeyRotationService({ clock: { now: () => new Date(), nowIso: () => '2024-01-15T08:12:00.000Z' } });

    for (const current of [1, 2, 7, 42]) {
      const plan = await service.planRotation(current, 'rotate-master-key', 100);
      assertPlanShape(plan);
      expect(plan.fromKeyVersion).toBe(current);
      expect(plan.toKeyVersion).toBe(current + 1);
      expect(plan.estimatedRecords).toBe(100);
    }
  }, VAULT_TIMEOUT);

  it('轮换计划里的 jobId 唯一（每次生成新作业）', async () => {
    const service = new KeyRotationService({ clock: { now: () => new Date(), nowIso: () => '2024-01-15T08:12:00.000Z' } });

    const first = await service.planRotation(1, 'rotate-master-key');
    const second = await service.planRotation(1, 'rotate-master-key');
    expect(first.jobId).not.toBe(second.jobId);
  }, VAULT_TIMEOUT);
});

describe('X-10 · 轮换作业状态结构与未实现边界', () => {
  it('新建的轮换作业状态为 pending，且游标为空', async () => {
    const service = new KeyRotationService({ clock: { now: () => new Date(), nowIso: () => '2024-01-15T08:12:00.000Z' } });

    const plan = await service.planRotation(1, 'rotate-master-key');
    const state = await service.getState(plan.jobId);

    expect(state).not.toBeNull();
    expect(state?.jobId).toBe(plan.jobId);
    expect(state?.status).toBe('pending');
    expect(state?.cursor).toBeNull();
    expect(state?.processedRecords).toBe(0);
    expect(state?.createdAt).toBe(plan.createdAt);
    expect(state?.updatedAt).toBe(plan.createdAt);
  }, VAULT_TIMEOUT);

  it('不存在的作业 id 返回 null（不抛异常）', async () => {
    const service = new KeyRotationService({ clock: { now: () => new Date(), nowIso: () => '2024-01-15T08:12:00.000Z' } });
    expect(await service.getState('not-exist-job-id')).toBeNull();
  }, VAULT_TIMEOUT);

  it('listStates 能列出全部作业', async () => {
    const service = new KeyRotationService({ clock: { now: () => new Date(), nowIso: () => '2024-01-15T08:12:00.000Z' } });

    await service.planRotation(1, 'rotate-master-key');
    await service.planRotation(2, 'rotate-master-key');

    const states = await service.listStates();
    expect(states.length).toBe(2);
    for (const state of states) {
      expect(state.status).toBe('pending');
    }
  }, VAULT_TIMEOUT);

  it('execute / resume 在本轮抛 LIFEHUB_E_ROTATION_IN_PROGRESS（阶段 5 实现）', async () => {
    const service = new KeyRotationService({ clock: { now: () => new Date(), nowIso: () => '2024-01-15T08:12:00.000Z' } });
    const plan = await service.planRotation(1, 'rotate-master-key');

    await expect(service.execute(plan.jobId)).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_ROTATION_IN_PROGRESS' }),
    );
    await expect(service.resume(plan.jobId)).rejects.toThrowError(
      expect.objectContaining({ code: 'LIFEHUB_E_ROTATION_IN_PROGRESS' }),
    );
  }, VAULT_TIMEOUT);

  it('RotationStatus 枚举取值与设计一致', () => {
    const statuses: readonly RotationStatus[] = ['pending', 'running', 'completed', 'failed'];
    expect(statuses).toEqual(['pending', 'running', 'completed', 'failed']);
  }, VAULT_TIMEOUT);
});

describe('X-10 · 轮换动作记入审计（X-07）', () => {
  it('rotateMasterKey 成功后记 rotate_key 审计', async () => {
    const runtime = createTestRuntime();
    await runtime.vault.createVault(PASSWORD);

    await runtime.vault.rotateMasterKey(PASSWORD, 'new-password-456');

    const logs = await runtime.audit.list();
    const rotateLogs = logs.filter((log) => log.action === 'rotate_key');
    expect(rotateLogs.length).toBeGreaterThanOrEqual(1);
    expect(rotateLogs[0]?.success).toBe(true);
  }, VAULT_TIMEOUT);
});

describe('X-10 · 轮换期间双 DEK 字段已预留（阶段 5 使用）', () => {
  it('VaultParams.previousDek 初始为 null（尚无上一版本 DEK）', async () => {
    const runtime: Runtime = createTestRuntime();
    await runtime.vault.createVault(PASSWORD);

    const params = await runtime.vaultRepository.load();
    expect(params?.previousDek).toBeNull();
    expect(params?.keyVersion).toBe(1);
    expect(params?.paramsVersion).toBe(1);
  }, VAULT_TIMEOUT);
});
