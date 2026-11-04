/**
 * PDF.js Worker 模块声明。
 *
 * 架构位置：apps/web 的类型声明层。
 *
 * 说明：供 `readPdfText` 在内存中动态导入 `pdf.worker.min.mjs` 并挂载到 `globalThis.pdfjsWorker`。
 */
declare module 'pdfjs-dist/legacy/build/pdf.worker.min.mjs';
