/**
 * 404 页面。
 *
 * 架构位置：apps/web 的「页面」层。
 */
import { Box, Button, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';

/**
 * 渲染 404 页面。
 *
 * @returns React 节点
 */
export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <Box sx={{ p: 6, textAlign: 'center' }} data-testid="not-found-page">
      <Typography variant="h4" sx={{ mb: 1 }}>
        404
      </Typography>
      <Typography variant="body1" sx={{ mb: 3, color: 'var(--lifehub-text-muted)' }}>
        页面不存在。
      </Typography>
      <Button variant="contained" onClick={() => navigate('/import')}>
        返回导入页
      </Button>
    </Box>
  );
}
