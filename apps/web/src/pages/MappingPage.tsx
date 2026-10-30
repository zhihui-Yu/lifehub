/**
 * 列头映射页面（UI-02）。
 *
 * 架构位置：apps/web 的「页面」层。
 *
 * 说明：改映射实时重算前 10 行预览；必填未映射时禁用「导入」并给中文提示；
 * 导入结束弹出「成功导入 N 条，跳过 M 条」并提供跳转入口（PRD A-11 / A-12）。
 */
import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Paper, Snackbar, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import type { ColumnMapping, DirectionRule } from '@lifehub/core';
import { ColumnMapper, DirectionResolver } from '@lifehub/core';
import { ColumnMappingBoard } from '@/components/mapping/ColumnMappingBoard';
import { PreviewTable } from '@/components/mapping/PreviewTable';
import { DirectionRulePicker } from '@/components/mapping/DirectionRulePicker';
import { CategoryRuleEditor } from '@/components/mapping/CategoryRuleEditor';
import { ErrorSummary } from '@/components/common/ErrorSummary';
import { StepIndicator } from '@/components/import/StepIndicator';
import { LoadingOverlay } from '@/components/common/LoadingOverlay';
import { useImportFlow } from '@/hooks/useImportFlow';
import { useImportStore } from '@/store';

/**
 * 渲染列头映射页面。
 *
 * @returns React 节点
 */
export function MappingPage() {
  const navigate = useNavigate();
  const { updateMapping, run } = useImportFlow();

  const plan = useImportStore((state) => state.plan);
  const mapping = useImportStore((state) => state.mapping);
  const preview = useImportStore((state) => state.preview);
  const summary = useImportStore((state) => state.summary);
  const error = useImportStore((state) => state.error);

  const [directionRule, setDirectionRule] = useState<DirectionRule>({
    mode: 'auto',
    incomeKeywords: [],
    expenseKeywords: [],
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // 计划就绪后用默认关键词表初始化一次方向规则。
  useEffect(() => {
    if (plan && directionRule.incomeKeywords.length === 0) {
      setDirectionRule({
        mode: 'auto',
        incomeKeywords: DirectionResolver.defaultIncomeKeywords(),
        expenseKeywords: DirectionResolver.defaultExpenseKeywords(),
      });
    }
  }, [directionRule.incomeKeywords.length, plan]);

  const validation = useMemo(() => {
    if (!plan) {
      return null;
    }
    const mapper = new ColumnMapper(plan.headers);
    return mapper.validate(mapping);
  }, [mapping, plan]);

  if (!plan) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="body1" sx={{ color: 'var(--lifehub-text-muted)' }}>
          请先在导入页选择一个 CSV 文件。
        </Typography>
        <Button sx={{ mt: 2 }} variant="outlined" onClick={() => navigate('/import')}>
          返回导入页
        </Button>
      </Box>
    );
  }

  const handleRun = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await run(mapping);
      if (result) {
        if (result.duplicateFile) {
          setNotice('该文件已导入过（内容完全相同），已跳过重复写入');
        } else {
          setNotice(`成功导入 ${result.rowImported} 条，跳过 ${result.rowSkipped} 条（重复）`);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="mapping-page">
      <StepIndicator activeStep={1} />
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}
      {plan.duplicateFile ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          该文件已导入过（{plan.duplicateOf}），重复导入将被跳过。
        </Alert>
      ) : null}

      <Paper variant="outlined" sx={{ p: 2.5, mb: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
          列头映射
        </Typography>
        <ColumnMappingBoard
          headers={plan.headers}
          mapping={mapping}
          onChange={(next) => void updateMapping(next)}
        />
        {validation && !validation.ok ? (
          <Alert severity="error" sx={{ mt: 2 }} data-testid="mapping-validation">
            {validation.message}
          </Alert>
        ) : null}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.5, mb: 2 }}>
        <DirectionRulePicker rule={directionRule} onChange={setDirectionRule} />
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.5, mb: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
          前 10 行预览
        </Typography>
        <PreviewTable rows={preview} />
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.5, mb: 2 }}>
        <CategoryRuleEditor rules={[]} onChange={() => undefined} />
      </Paper>

      {summary ? <ErrorSummary errors={summary.errors} /> : null}

      <Box sx={{ display: 'flex', gap: 1.5, mt: 2 }}>
        <Button variant="text" onClick={() => navigate('/import')}>
          重新选择文件
        </Button>
        <Button
          variant="contained"
          disabled={!validation?.ok || busy}
          onClick={() => void handleRun()}
          data-testid="run-import-button"
        >
          开始导入
        </Button>
        {summary ? (
          <Button variant="outlined" onClick={() => navigate('/bills')}>
            查看账单列表
          </Button>
        ) : null}
      </Box>

      <LoadingOverlay visible={busy} label="正在导入…" />
      <Snackbar
        open={notice !== null}
        autoHideDuration={6000}
        onClose={() => setNotice(null)}
        message={notice ?? ''}
        action={
          <Button color="primary" size="small" onClick={() => navigate('/bills')}>
            查看账单列表
          </Button>
        }
      />
    </div>
  );
}
