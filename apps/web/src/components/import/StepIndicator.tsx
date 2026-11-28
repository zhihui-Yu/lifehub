/**
 * 导入步骤指示器。
 *
 * 架构位置：apps/web 的「导入组件」层。
 */
import { Box, Step, StepLabel, Stepper } from '@mui/material';

/** 导入步骤定义。 */
const STEPS = [{ title: '选择文件' }, { title: '列头映射' }, { title: '导入完成' }];

/** 步骤指示器组件的属性。 */
export interface StepIndicatorProps {
  /** 当前步骤（0 基；传 3 表示全部步骤已完成）。 */
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
    <Box sx={{ mb: 2.5 }} data-testid="import-step-indicator" data-active-step={activeStep}>
      <Stepper activeStep={activeStep} alternativeLabel>
        {STEPS.map((step, index) => {
          const isCompleted = activeStep > index;
          const isActive = activeStep === index;
          return (
            <Step key={step.title} completed={isCompleted}>
              <StepLabel
                data-testid={`import-step-${index + 1}`}
                data-step-state={isCompleted ? 'completed' : isActive ? 'active' : 'pending'}
                sx={{
                  '& .MuiStepIcon-root': {
                    color: 'var(--lifehub-border)',
                  },
                  '& .MuiStepIcon-root.Mui-active': {
                    color: 'var(--lifehub-primary)',
                  },
                  '& .MuiStepIcon-root.Mui-completed': {
                    color: 'var(--lifehub-income)',
                  },
                  '& .MuiStepLabel-label': {
                    fontSize: '0.875rem',
                    color: 'var(--lifehub-text-muted)',
                    fontWeight: 500,
                  },
                  '& .MuiStepLabel-label.Mui-active': {
                    color: 'var(--lifehub-primary)',
                    fontWeight: 700,
                  },
                  '& .MuiStepLabel-label.Mui-completed': {
                    color: 'var(--lifehub-income)',
                    fontWeight: 600,
                  },
                }}
              >
                {step.title}
              </StepLabel>
            </Step>
          );
        })}
      </Stepper>
    </Box>
  );
}
