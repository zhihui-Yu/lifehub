/**
 * 导入步骤指示器。
 *
 * 架构位置：apps/web 的「导入组件」层。
 */
import { Box, Step, StepLabel, Stepper, Typography } from '@mui/material';

/** 导入步骤定义。 */
const STEPS = [
  { title: '选择文件', description: '拖拽或选择 CSV 文件' },
  { title: '列头映射', description: '确认各列对应的语义字段' },
  { title: '导入完成', description: '写入本地加密库' },
];

/** 步骤指示器组件的属性。 */
export interface StepIndicatorProps {
  /** 当前步骤（0 基）。 */
  activeStep: number;
}

/**
 * 渲染步骤指示器。
 *
 * @param props 组件属性
 * @returns React 节点
 */
export function StepIndicator({ activeStep }: StepIndicatorProps) {
  return (
    <Box sx={{ mb: 3 }}>
      <Stepper activeStep={activeStep} alternativeLabel>
        {STEPS.map((step) => (
          <Step key={step.title}>
            <StepLabel>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {step.title}
              </Typography>
              <Typography variant="caption" sx={{ color: 'var(--lifehub-text-muted)' }}>
                {step.description}
              </Typography>
            </StepLabel>
          </Step>
        ))}
      </Stepper>
    </Box>
  );
}
