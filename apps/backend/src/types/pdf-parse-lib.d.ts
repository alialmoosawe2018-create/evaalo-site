// The deep entry point of pdf-parse (avoids the package's debug harness on import).
// @types/pdf-parse only declares the top-level module, so re-declare the lib path.
declare module 'pdf-parse/lib/pdf-parse.js' {
    import pdfParse from 'pdf-parse';
    export default pdfParse;
}
