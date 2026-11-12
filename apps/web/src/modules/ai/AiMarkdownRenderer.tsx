/**
 * DeepSeek 网页风格 Markdown 富文本渲染组件。
 *
 * 职责：
 * 1. 自动识别并折叠渲染 DeepSeek R1 `💭 【深度思考过程】` 推理链；
 * 2. 原生解析并美化渲染 Markdown 标题（# / ## / ###）、表格（| A | B |）、引用高亮块（> ）、
 *    代码块（```）、有序/无序列表（1. / - ）以及行内加粗（**text**）与行内代码（`code`），
 *    彻底告别裸露的 Markdown 符号与纯文本堆砌。
 */
import React, { useState } from 'react';
import {
  Box,
  Collapse,
  Divider,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import PsychologyOutlined from '@mui/icons-material/PsychologyOutlined';

export interface AiMarkdownRendererProps {
  /** 待渲染的 Markdown 文本内容。 */
  content: string;
}

/**
 * 解析并渲染行内 Markdown 语法（**加粗**、`行内代码`、*斜体*）。
 */
function renderInlineMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // 匹配 **bold** 或 `code`
  const tokenRegex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(
        <Box
          component="strong"
          key={`b-${keyIdx++}`}
          sx={{ fontWeight: 700, color: 'var(--lifehub-text)' }}
        >
          {token.slice(2, -2)}
        </Box>,
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <Box
          component="code"
          key={`c-${keyIdx++}`}
          sx={{
            px: 0.7,
            py: 0.15,
            mx: 0.25,
            borderRadius: 1,
            fontSize: '0.86em',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            backgroundColor: 'rgba(99, 102, 241, 0.1)',
            color: 'primary.main',
          }}
        >
          {token.slice(1, -1)}
        </Box>,
      );
    }
    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

/**
 * 判断一行是否为 Markdown 表格分隔行（如 `| --- | :---: |`）。
 */
function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return false;
  const cells = trimmed
    .slice(1, -1)
    .split('|')
    .map((c) => c.trim());
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

/**
 * 切分 Markdown 表格行的单元格。
 */
function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

/**
 * 渲染正文 Markdown 块序列。
 */
function renderMarkdownBlocks(markdown: string): React.ReactNode[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i] ?? '';
    const trimmed = rawLine.trim();

    // 1. 空行跳过
    if (!trimmed) {
      i++;
      continue;
    }

    // 2. 代码块 ```
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) {
        codeLines.push(lines[i] ?? '');
        i++;
      }
      if (i < lines.length) i++; // 跳过闭合 ```
      elements.push(
        <Box
          key={`code-${i}`}
          sx={{
            my: 1.5,
            borderRadius: 2,
            overflow: 'hidden',
            border: '1px solid var(--lifehub-border)',
            backgroundColor: 'var(--lifehub-bg)',
          }}
        >
          {lang && (
            <Box
              sx={{
                px: 1.5,
                py: 0.5,
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--lifehub-text-muted)',
                borderBottom: '1px solid var(--lifehub-border)',
                fontFamily: 'monospace',
              }}
            >
              {lang}
            </Box>
          )}
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 1.5,
              fontSize: 12.5,
              lineHeight: 1.6,
              overflowX: 'auto',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            }}
          >
            {codeLines.join('\n')}
          </Box>
        </Box>,
      );
      continue;
    }

    // 3. 水平分割线 --- 或 ***
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      elements.push(<Divider key={`hr-${i}`} sx={{ my: 1.75 }} />);
      i++;
      continue;
    }

    // 4. 标题 # / ## / ### / ####
    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1]?.length ?? 2;
      const titleText = headingMatch[2] ?? '';
      const fontSize = level === 1 ? '1.15rem' : level === 2 ? '1.05rem' : '0.96rem';
      elements.push(
        <Typography
          key={`h-${i}`}
          component="div"
          sx={{
            fontWeight: 700,
            fontSize,
            mt: elements.length === 0 ? 0.25 : 2,
            mb: 1,
            pb: level <= 2 ? 0.6 : 0,
            borderBottom: level <= 2 ? '1px solid var(--lifehub-border)' : 'none',
            color: 'var(--lifehub-text)',
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
          }}
        >
          {renderInlineMarkdown(titleText)}
        </Typography>,
      );
      i++;
      continue;
    }

    // 5. Markdown 表格
    if (
      trimmed.startsWith('|') &&
      trimmed.endsWith('|') &&
      i + 1 < lines.length &&
      isTableSeparatorLine(lines[i + 1] ?? '')
    ) {
      const headers = splitTableRow(trimmed);
      i += 2; // 跳过表头和分隔线
      const rows: string[][] = [];
      while (
        i < lines.length &&
        (lines[i] ?? '').trim().startsWith('|') &&
        (lines[i] ?? '').trim().endsWith('|')
      ) {
        rows.push(splitTableRow(lines[i] ?? ''));
        i++;
      }
      elements.push(
        <Box
          key={`tbl-${i}`}
          sx={{
            my: 1.5,
            overflowX: 'auto',
            borderRadius: 2,
            border: '1px solid var(--lifehub-border)',
          }}
        >
          <Table size="small">
            <TableHead>
              <TableRow sx={{ backgroundColor: 'var(--lifehub-bg)' }}>
                {headers.map((h, hIdx) => (
                  <TableCell key={hIdx} sx={{ fontWeight: 700, fontSize: 12.5 }}>
                    {renderInlineMarkdown(h)}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row, rIdx) => (
                <TableRow key={rIdx}>
                  {row.map((cell, cIdx) => (
                    <TableCell key={cIdx} sx={{ fontSize: 12.5 }}>
                      {renderInlineMarkdown(cell)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>,
      );
      continue;
    }

    // 6. 引用高亮块 >
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('>')) {
        quoteLines.push((lines[i] ?? '').trim().replace(/^>\s?/, ''));
        i++;
      }
      elements.push(
        <Box
          key={`quote-${i}`}
          sx={{
            my: 1.25,
            py: 1.1,
            px: 1.75,
            borderRadius: '4px 10px 10px 4px',
            borderLeft: '3.5px solid',
            borderLeftColor: 'primary.main',
            backgroundColor: 'rgba(99, 102, 241, 0.06)',
            fontSize: 13.5,
            lineHeight: 1.7,
          }}
        >
          {quoteLines.map((ql, qIdx) => (
            <Box key={qIdx} sx={{ mb: qIdx < quoteLines.length - 1 ? 0.5 : 0 }}>
              {renderInlineMarkdown(ql)}
            </Box>
          ))}
        </Box>,
      );
      continue;
    }

    // 7. 无序列表 (- / * / •)
    if (/^([-*•])\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^([-*•])\s+/.test((lines[i] ?? '').trim())) {
        items.push((lines[i] ?? '').trim().replace(/^([-*•])\s+/, ''));
        i++;
      }
      elements.push(
        <Stack key={`ul-${i}`} component="ul" spacing={0.6} sx={{ my: 1, pl: 2.5, m: 0 }}>
          {items.map((it, idx) => (
            <Box
              component="li"
              key={idx}
              sx={{
                fontSize: 14,
                lineHeight: 1.7,
                color: 'var(--lifehub-text)',
                '&::marker': { color: 'primary.main' },
              }}
            >
              {renderInlineMarkdown(it)}
            </Box>
          ))}
        </Stack>,
      );
      continue;
    }

    // 8. 有序列表 (1. / 2.)
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test((lines[i] ?? '').trim())) {
        items.push((lines[i] ?? '').trim().replace(/^\d+\.\s+/, ''));
        i++;
      }
      elements.push(
        <Stack key={`ol-${i}`} component="ol" spacing={0.6} sx={{ my: 1, pl: 2.5, m: 0 }}>
          {items.map((it, idx) => (
            <Box
              component="li"
              key={idx}
              sx={{
                fontSize: 14,
                lineHeight: 1.7,
                color: 'var(--lifehub-text)',
                '&::marker': { fontWeight: 700, color: 'primary.main' },
              }}
            >
              {renderInlineMarkdown(it)}
            </Box>
          ))}
        </Stack>,
      );
      continue;
    }

    // 9. 普通段落
    elements.push(
      <Typography
        key={`p-${i}`}
        component="div"
        sx={{
          fontSize: 14,
          lineHeight: 1.75,
          my: 0.75,
          color: 'var(--lifehub-text)',
          wordBreak: 'break-word',
        }}
      >
        {renderInlineMarkdown(trimmed)}
      </Typography>,
    );
    i++;
  }

  return elements;
}

/**
 * 渲染 DeepSeek 风格 Markdown 消息体（含 R1 深度思考折叠栏与结构化正文）。
 */
export function AiMarkdownRenderer({ content }: AiMarkdownRendererProps) {
  const [reasoningExpanded, setReasoningExpanded] = useState(false);

  // 检测是否包含 DeepSeek R1 深度思考段落
  let reasoningText = '';
  let mainText = content;
  if (content.startsWith('💭 【深度思考过程】') && content.includes('\n\n---\n\n')) {
    const splitIdx = content.indexOf('\n\n---\n\n');
    reasoningText = content
      .slice('💭 【深度思考过程】'.length, splitIdx)
      .trim();
    mainText = content.slice(splitIdx + '\n\n---\n\n'.length).trim();
  }

  return (
    <Box
      sx={{
        width: '100%',
        minWidth: 0,
        maxWidth: '100%',
        overflowWrap: 'anywhere',
        wordBreak: 'break-word',
      }}
    >
      {reasoningText && (
        <Paper
          variant="outlined"
          sx={{
            mb: 1.5,
            borderRadius: 2,
            backgroundColor: 'var(--lifehub-bg)',
            borderColor: 'var(--lifehub-border)',
            overflow: 'hidden',
          }}
        >
          <Box
            onClick={() => setReasoningExpanded((prev) => !prev)}
            sx={{
              px: 1.5,
              py: 0.85,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              userSelect: 'none',
            }}
          >
            <Stack direction="row" spacing={0.75} alignItems="center">
              <PsychologyOutlined sx={{ fontSize: 16, color: 'primary.main' }} />
              <Typography variant="caption" sx={{ fontWeight: 700, color: 'var(--lifehub-text-muted)' }}>
                已深度思考（点击{reasoningExpanded ? '收起' : '展开'}推理过程）
              </Typography>
            </Stack>
            {reasoningExpanded ? (
              <ExpandLess sx={{ fontSize: 16, color: 'var(--lifehub-text-muted)' }} />
            ) : (
              <ExpandMore sx={{ fontSize: 16, color: 'var(--lifehub-text-muted)' }} />
            )}
          </Box>
          <Collapse in={reasoningExpanded}>
            <Box
              sx={{
                px: 2,
                py: 1.25,
                borderTop: '1px solid var(--lifehub-border)',
                borderLeft: '3px solid var(--lifehub-border)',
                ml: 1.5,
                my: 1,
                fontSize: 12.5,
                lineHeight: 1.65,
                color: 'var(--lifehub-text-muted)',
                whiteSpace: 'pre-wrap',
              }}
            >
              {reasoningText}
            </Box>
          </Collapse>
        </Paper>
      )}

      <Box>{renderMarkdownBlocks(mainText)}</Box>
    </Box>
  );
}
