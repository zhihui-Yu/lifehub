/**
 * 导入步骤指示器。
 *
 * 架构位置：apps/web 的「导入组件」层。
 */
import { Box, Step, StepLabel, Stepper, Typography } from '@mui/material';

/** 导入步骤定义。 */
const STEPS = [{ title: '选择文件' }, { title: '列头映射' }, { title: '导入完成' }];

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
    <Box sx={{ mb: 2.5 }}>
      <Stepper activeStep={activeStep} alternativeLabel>
        {STEPS.map((step) => (
          <Step key={step.title}>
            <StepLabel
              sx={{
                '& .MuiStepLabel-label': {
                  color: 'var(--lifehub-text)',
                  fontWeight: 500,
                },
                '& .MuiStepLabel-label.Mui-active': {
                  color: 'primary.main',
                  fontWeight: 700,
                },
                '& .MuiStepLabel-label.Mui-completed': {
                  color: 'var(--lifehub-text)',
                },
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 600, color: 'var(--lifehub-text)' }}>
                {step.title}
              </Typography>
            </StepLabel>
          </Step>
        ))}
      </Stepper>
    </Box>
  );
}
