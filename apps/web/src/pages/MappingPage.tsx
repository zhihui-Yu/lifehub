/**
 * 列头映射页面（UI-02）。
 *
 * 架构位置：apps/web 的「页面」层。
 *
 * 说明：改映射实时重算前 10 行预览；必填未映射时禁用「导入」并给中文提示；
 * 导入结束弹出「成功导入 N 条，跳过 M 条」并提供跳转入口（PRD A-11 / A-12）。
 */
import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Checkbox, Chip, FormControlLabel, Paper, Snackbar, Stack, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import type { BillField, CrossSourceCandidate, DirectionRule, SourceChannel } from '@lifehub/core';
import { ColumnMapper, DirectionResolver, SOURCE_CHANNEL_LABELS } from '@lifehub/core';
import { ColumnMappingBoard } from '@/components/mapping/ColumnMappingBoard';
import { PreviewTable } from '@/components/mapping/PreviewTable';
import { DirectionRulePicker } from '@/components/mapping/DirectionRulePicker';
import { CategoryRuleEditor } from '@/components/mapping/CategoryRuleEditor';
import { ErrorSummary } from '@/components/common/ErrorSummary';
import { StepIndicator } from '@/components/import/StepIndicator';
import { LoadingOverlay } from '@/components/common/LoadingOverlay';
import { useImportFlow } from '@/hooks/useImportFlow';
import { useImportStore } from '@/store';

/** 字段语义中文名。 */
const FIELD_DISPLAY_LABELS: Record<BillField, string> = {
  occurredAt: '日期',
  amount: '金额',
  counterparty: '交易对方',
  category: '分类',
  direction: '收/支',
  balance: '余额',
  note: '备注',
  ignore: '忽略',
};

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
  const skipCrossSourceDuplicates = useImportStore((state) => state.skipCrossSourceDuplicates);
  const setSkipCrossSourceDuplicates = useImportStore((state) => state.setSkipCrossSourceDuplicates);

  const [directionRule, setDirectionRule] = useState<DirectionRule>({
    mode: 'auto',
    incomeKeywords: [],
    expenseKeywords: [],
  });
  const [ busy, setBusy ] = useState(false);
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ showMappingDetails, setShowMappingDetails ] = useState(true);
  const [ allowReimport, setAllowReimport ] = useState(true);

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
      const result = plan.duplicateFile
        ? await run(mapping, { allowDuplicate: allowReimport, overwriteExisting: allowReimport })
        : await run(mapping);
      if (result) {
        if (result.duplicateFile) {
          setNotice('该文件已导入过（内容完全相同），已跳过重复写入');
        } else {
          const parts = [`成功导入 ${result.rowImported} 条`];
          if (result.rowCrossSourceDuplicate > 0) {
            parts.push(
              `其中 ${result.rowCrossSourceDuplicate} 条因跨来源重复（微信 / 支付宝 与 银行视为同一笔）已自动跳过`,
            );
          } else if (result.rowSkipped > 0) {
            parts.push(`跳过 ${result.rowSkipped} 条（重复）`);
          }
          setNotice(parts.join('，'));
        }
      }
    } finally {
      setBusy(false);
    }
  };

  /** 跨来源重复候选的提示文案（取首个命中的既有渠道名）。 */
  const crossSourceHint = (candidates: CrossSourceCandidate[]): string | null => {
    if (candidates.length === 0) {
      return null;
    }
    const channel = SOURCE_CHANNEL_LABELS[candidates[0]?.existingChannel as SourceChannel] ?? '其它来源';
    return `检测到 ${candidates.length} 条可能与「${channel}」流水重复的账单（同日 + 同额 + 同方向，多为「微信 / 支付宝绑定银行卡付款」）。默认按跨来源重复跳过，避免同一笔重复计入。`;
  };

  const matchedFieldChips = Object.entries(mapping)
    .filter(([, field]) => field && field !== 'ignore')
    .map(([colIdxText, field]) => {
      const colIdx = Number.parseInt(colIdxText, 10);
      const headerName = plan.headers[colIdx] ?? `列 ${colIdx + 1}`;
      const label = FIELD_DISPLAY_LABELS[field] ?? field;
      return { key: `${colIdx}-${field}`, text: `${label} ← ${headerName}` };
    });

  return (
    <div data-testid="mapping-page">
      <StepIndicator activeStep={1} />
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}
      {!summary && plan.duplicateFile ? (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          data-testid="duplicate-file-alert"
          action={
            <Button
              color="warning"
              variant="contained"
              size="small"
              disabled={!validation?.ok || busy}
              onClick={() => void handleRun()}
              data-testid="reimport-button"
            >
              立即重新导入
            </Button>
          }
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            该文件已导入过（{plan.duplicateOf}）。
          </Typography>
          <FormControlLabel
            sx={{ mt: 0.5, color: 'inherit' }}
            control={
              <Checkbox
                size="small"
                checked={allowReimport}
                onChange={(event) => setAllowReimport(event.target.checked)}
                data-testid="allow-reimport-checkbox"
              />
            }
            label="允许重复导入（覆盖该文件此前导入的旧账单）"
          />
        </Alert>
      ) : null}
      {plan.crossSourceCandidates.length > 0 ? (
        <Alert severity="info" sx={{ mb: 2 }} data-testid="cross-source-hint">
          {crossSourceHint(plan.crossSourceCandidates)}
        </Alert>
      ) : null}

      {validation?.ok ? (
        <Alert
          severity="success"
          sx={{ mb: 2 }}
          data-testid="auto-mapping-banner"
          action={
            <Button
              color="success"
              variant="contained"
              size="small"
              disabled={busy}
              onClick={() => void handleRun()}
              data-testid="quick-commit-button"
            >
              直接开始导入
            </Button>
          }
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.75 }}>
            系统已自动识别并完成全部字段匹配（共 {plan.rowCount} 行待导入），无需手动选择字段！
          </Typography>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {matchedFieldChips.map((chip) => (
              <Chip key={chip.key} label={chip.text} size="small" color="success" variant="outlined" />
            ))}
          </Stack>
        </Alert>
      ) : null}

      <Paper
        variant="outlined"
        sx={{ p: 2.5, mb: 2, backgroundColor: 'var(--lifehub-surface)', borderColor: 'var(--lifehub-border)' }}
      >
        <Typography variant="subtitle1" sx={{ mb: 1.5, fontWeight: 600, color: 'var(--lifehub-text)' }}>
          前 10 行预览
        </Typography>
        <PreviewTable rows={preview} />
      </Paper>

      <Paper
        variant="outlined"
        sx={{ p: 2.5, mb: 2, backgroundColor: 'var(--lifehub-surface)', borderColor: 'var(--lifehub-border)' }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'var(--lifehub-text)' }}>
            列头映射（系统已自动选完，仅在需要时手工微调）
          </Typography>
          <Button
            size="small"
            variant="text"
            aria-expanded={showMappingDetails}
            aria-controls="column-mapping-details"
            onClick={() => setShowMappingDetails((prev) => !prev)}
            data-testid="toggle-mapping-details"
          >
            {showMappingDetails ? '收起字段映射' : '展开字段映射'}
          </Button>
        </Box>
        <Box id="column-mapping-details" sx={{ display: showMappingDetails ? 'block' : 'none' }}>
          <ColumnMappingBoard
            headers={plan.headers}
            mapping={mapping}
            onChange={(next) => void updateMapping(next)}
          />
        </Box>
        {validation && !validation.ok ? (
          <Alert severity="error" sx={{ mt: 2 }} data-testid="mapping-validation">
            {validation.message}
          </Alert>
        ) : null}
      </Paper>

      <Paper
        variant="outlined"
        sx={{ p: 2.5, mb: 2, backgroundColor: 'var(--lifehub-surface)', borderColor: 'var(--lifehub-border)' }}
      >
        <DirectionRulePicker rule={directionRule} onChange={setDirectionRule} />
      </Paper>

      <Paper
        variant="outlined"
        sx={{ p: 2.5, mb: 2, backgroundColor: 'var(--lifehub-surface)', borderColor: 'var(--lifehub-border)' }}
      >
        <CategoryRuleEditor rules={[]} onChange={() => undefined} />
      </Paper>

      <Paper
        variant="outlined"
        sx={{ p: 2.5, mb: 2, backgroundColor: 'var(--lifehub-surface)', borderColor: 'var(--lifehub-border)' }}
      >
        <FormControlLabel
          sx={{ color: 'var(--lifehub-text)' }}
          control={
            <Checkbox
              checked={skipCrossSourceDuplicates}
              onChange={(event) => setSkipCrossSourceDuplicates(event.target.checked)}
              data-testid="skip-cross-source"
            />
          }
          label="跨来源去重：把与银行流水同日同额同方向的微信 / 支付宝账单视为同一笔，自动跳过"
        />
      </Paper>

      {summary ? <ErrorSummary errors={summary.errors} /> : null}

      <Box sx={{ display: 'flex', gap: 1.5, mt: 2 }}>
        <Button
          variant="text"
          onClick={() => {
            useImportStore.getState().reset();
            navigate('/import');
          }}
        >
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
