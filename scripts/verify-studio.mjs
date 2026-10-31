import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const pointer = 'version https://git-lfs.github.com/spec/v1';
const codeExtension = /\.(?:[cm]?[jt]sx?|css|json)$/i;
const within = (parent, child) => child === parent || child.startsWith(parent + path.sep);
const walk = directory => fs.existsSync(directory) ? fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(directory, entry.name);
  if (entry.isSymbolicLink()) throw Error(`Studio files must not use symlinks: ${file}`);
  return entry.isDirectory() ? walk(file) : entry.isFile() ? [file] : [];
}) : [];

/** Build-time closure check. Does not execute copied application code or fetch URLs. */
export function verifyStudio(root) {
  root = path.resolve(root);
  const studio = path.join(root, 'src/studio'), route = path.join(root, 'app/studio');
  const media = path.join(root, 'public/studio/media');
  const errors = [], seen = new Set(), references = new Set(), fonts = new Set();
  for (const file of ['app/studio/page.tsx', 'app/studio/layout.tsx']) {
    if (!fs.existsSync(path.join(root, file))) errors.push(`Missing studio route: ${file}`);
  }
  const mediaFiles = walk(media);
  if (!mediaFiles.length) errors.push('No copied studio media found in public/studio/media');
  const report = (file, message) => errors.push(`${path.relative(root, file)}: ${message}`);
  const resolveLocal = (file, name) => {
    const base = name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : path.resolve(path.dirname(file), name);
    if (!within(root, base)) { report(file, `Import escapes project: ${name}`); return; }
    const candidates = [base, ...['.ts','.tsx','.js','.jsx','.mjs','.css','.json'].map(ext => base + ext), ...['.ts','.tsx','.js','.jsx'].map(ext => path.join(base, 'index' + ext))];
    const target = candidates.find(p => fs.existsSync(p) && fs.statSync(p).isFile());
    if (!target) report(file, `Unresolved copied import: ${name}`);
    return target;
  };
  const inspectURL = (file, url) => {
    if (/^\/media(?:\/|$)/.test(url)) { report(file, `Original /media URL remains: ${url}`); return; }
    if (/^\/(?:assets|asset-delivery)(?:\/|$)/.test(url)) { report(file, `3D asset URL in lightweight studio: ${url}`); return; }
    if (!url.startsWith('/studio/media/')) return;
    let clean;
    try { clean = decodeURIComponent(url.split(/[?#]/)[0]); } catch { report(file, `Invalid media URL: ${url}`); return; }
    const target = path.resolve(root, 'public', '.' + clean);
    if (!within(media, target)) { report(file, `Media URL escapes studio directory: ${url}`); return; }
    references.add(target);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) report(file, `Missing copied media: ${url}`);
  };
  const inspectImport = (file, name) => {
    if (/^(?:three(?:\/|$)|@react-three\/)/.test(name) || /(?:^|\/)runtime(?:\/|$)/.test(name)) {
      report(file, `3D/runtime import in lightweight studio: ${name}`); return;
    }
    if (name.startsWith('.') || name.startsWith('@/')) {
      const target = resolveLocal(file, name);
      if (target) inspectFile(target);
    }
  };
  const localFontPath = (file, value) => {
    const target = path.resolve(path.dirname(file), value);
    if (!within(root, target) || !/\.(?:woff2?|ttf|otf)$/i.test(target)) { report(file, `Invalid local font path: ${value}`); return; }
    fonts.add(target);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) report(file, `Missing local font: ${value}`);
  };
  function inspectFile(file) {
    if (seen.has(file) || !codeExtension.test(file)) return;
    seen.add(file);
    const source = fs.readFileSync(file, 'utf8');
    if (source.startsWith(pointer)) { report(file, 'Unhydrated Git LFS pointer'); return; }
    if (/\.css$/i.test(file)) {
      const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
      for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/g)) {
        const url = match[1] ?? match[2] ?? match[3];
        inspectURL(file, url);
        if (/^\.?\.\//.test(url)) {
          const target = path.resolve(path.dirname(file), url.split(/[?#]/)[0]);
          if (!within(root, target) || !fs.existsSync(target)) report(file, `Unresolved CSS resource: ${url}`);
          else if (/\.(?:woff2?|ttf|otf)$/i.test(target)) fonts.add(target);
        }
      }
      for (const match of css.matchAll(/@import\s+["']([^"']+)["']/g)) inspectImport(file, match[1]);
      return;
    }
    if (/\.json$/i.test(file)) {
      const visit = value => {
        if (typeof value === 'string') inspectURL(file, value);
        else if (value && typeof value === 'object') Object.values(value).forEach(visit);
      };
      try { visit(JSON.parse(source)); } catch { report(file, 'Invalid JSON data fixture'); }
      return;
    }
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, /\.tsx$/i.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const constants = new Map(), fontImports = new Set();
    const unwrap = value => { while (value && (ts.isAsExpression(value) || ts.isSatisfiesExpression(value) || ts.isParenthesizedExpression(value))) value = value.expression; return value; };
    function collect(node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) constants.set(node.name.text, unwrap(node.initializer));
      if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === 'next/font/local' && node.importClause?.name) fontImports.add(node.importClause.name.text);
      ts.forEachChild(node, collect);
    }
    collect(ast);
    const values = (input, depth = 0) => {
      const node = unwrap(input);
      if (!node || depth > 8) return;
      if (ts.isStringLiteralLike(node)) return [node.text];
      if (ts.isIdentifier(node)) return values(constants.get(node.text), depth + 1);
      if (ts.isElementAccessExpression(node)) return values(node.expression, depth + 1);
      if (ts.isArrayLiteralExpression(node)) {
        const entries = node.elements.map(value => values(value, depth + 1));
        if (entries.every(Boolean)) return entries.flat();
      }
    };
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) inspectImport(file, node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require') && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) inspectImport(file, node.arguments[0].text);
      if (ts.isStringLiteralLike(node)) inspectURL(file, node.text);
      if (ts.isTemplateExpression(node) && /^\/(?:studio\/media|media|assets|asset-delivery)\//.test(node.head.text)) {
        if (!node.head.text.startsWith('/studio/media/')) inspectURL(file, node.head.text);
        else {
          let paths = [node.head.text];
          for (const span of node.templateSpans) {
            const variants = values(span.expression);
            if (!variants?.length || paths.length * variants.length > 10000) { report(file, `Cannot statically verify dynamic media: ${node.getText(ast)}`); paths = []; break; }
            paths = paths.flatMap(prefix => variants.map(value => prefix + value + span.literal.text));
          }
          paths.forEach(url => inspectURL(file, url));
        }
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && fontImports.has(node.expression.text)) {
        const font = unwrap(node.arguments[0]);
        if (font && ts.isObjectLiteralExpression(font)) for (const prop of font.properties) {
          if (!ts.isPropertyAssignment(prop) || prop.name.getText(ast).replace(/["']/g, '') !== 'src') continue;
          const src = unwrap(prop.initializer);
          if (ts.isStringLiteralLike(src)) localFontPath(file, src.text);
          else if (ts.isArrayLiteralExpression(src)) for (const item of src.elements) {
            if (!ts.isObjectLiteralExpression(item)) continue;
            for (const entry of item.properties) if (ts.isPropertyAssignment(entry) && entry.name.getText(ast).replace(/["']/g, '') === 'path' && ts.isStringLiteralLike(entry.initializer)) localFontPath(file, entry.initializer.text);
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  // These two shells belong to the lounge route, not the lightweight studio route.
  // If /studio imports either one, recursive dependency inspection still checks it.
  const loungeShells = new Set(['LoungeEntry.tsx', 'LoungeStudioOverlay.tsx'].map(name => path.join(studio, 'components', name)));
  for (const file of [...walk(studio), ...walk(route)]) if (!loungeShells.has(file)) inspectFile(file);
  for (const file of new Set([...mediaFiles, ...fonts])) {
    if (!fs.existsSync(file)) continue;
    const head = Buffer.alloc(128), fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, head, 0, head.length, 0); } finally { fs.closeSync(fd); }
    if (!fs.statSync(file).size) report(file, 'Empty copied asset');
    if (head.toString('utf8').startsWith(pointer)) report(file, 'Git LFS pointer instead of media; enable Vercel Settings > Git > Git LFS and redeploy, or run git lfs pull locally');
  }
  if (errors.length) throw Error(`Studio delivery verification failed:\n${[...new Set(errors)].join('\n')}`);
  return { mediaFiles: mediaFiles.length, mediaBytes: mediaFiles.reduce((total, file) => total + fs.statSync(file).size, 0), referencedMedia: references.size, sourceFiles: seen.size, localFonts: fonts.size };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = verifyStudio(fileURLToPath(new URL('../', import.meta.url)));
  console.log(`Studio delivery ready: ${result.mediaFiles} media files, ${(result.mediaBytes / 1e6).toFixed(2)} MB; ${result.referencedMedia} referenced media paths; ${result.sourceFiles} source/data/style files; ${result.localFonts} local font files.`);
}
