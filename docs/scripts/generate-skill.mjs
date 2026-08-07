#!/usr/bin/env node
/**
 * generate-skill.mjs
 *
 * 把 Starlight 文档站（src/content/docs/）转换为 Claude Code 技能包结构：
 *
 *   <output>/
 *   ├── SKILL.md              # frontmatter + 页面索引 + 使用说明
 *   └── references/           # 每个文档页一个 .md，保持原目录结构
 *
 * 纯 Node.js，零依赖。用法：
 *
 *   node scripts/generate-skill.mjs \
 *     --source ./src/content/docs \
 *     --output ./dist/skill \
 *     --name my-docs \
 *     --description "My project documentation. Use when working on my-docs."
 */
import { readdirSync, readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, basename, dirname, sep } from 'node:path';

const FILE_EXT_RE = /\.(mdx?|mdown|mkdn|mkd|mdwn)$/;

// ---------------------------------------------------------------------------
// 参数解析
// ---------------------------------------------------------------------------
function parseArgs(argv) {
	const args = { source: './src/content/docs', output: './dist/skill' };
	for (let i = 0; i < argv.length; i++) {
		const key = argv[i];
		if (key.startsWith('--')) {
			const k = key.slice(2);
			const v = argv[i + 1];
			if (v !== undefined && !v.startsWith('--')) {
				args[k] = v;
				i++;
			} else {
				args[k] = true;
			}
		}
	}
	return args;
}

// ---------------------------------------------------------------------------
// 遍历 docs 目录：忽略 `_` 前缀文件/目录（与 Starlight 约定一致）
// ---------------------------------------------------------------------------
function walk(dir, base, results = []) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name.startsWith('_')) continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			walk(full, base, results);
		} else if (FILE_EXT_RE.test(entry.name)) {
			const rel = relative(base, full).split(sep).join('/');
			results.push({ full, rel });
		}
	}
	return results;
}

// ---------------------------------------------------------------------------
// frontmatter 解析：只提取 title / description，正文原样保留
// ---------------------------------------------------------------------------
function getField(frontmatter, key) {
	const m = frontmatter.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
	if (!m) return null;
	let value = m[1].trim();
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		value = value.slice(1, -1);
	}
	return value || null;
}

function parseFrontmatter(content) {
	const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
	if (!m) return { title: null, description: null, body: content };
	return {
		title: getField(m[1], 'title'),
		description: getField(m[1], 'description'),
		body: content.slice(m[0].length),
	};
}

// ---------------------------------------------------------------------------
// 工具：slug → kebab-case id；多行 YAML 值折叠
// ---------------------------------------------------------------------------
function toId(rel) {
	return (
		rel
			.replace(FILE_EXT_RE, '')
			.split('/')
			.filter(Boolean)
			.map((seg) => seg.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, ''))
			.join('-')
			.toLowerCase() || 'index'
	);
}

function yamlFold(str) {
	if (!str) return '';
	return str.includes('\n')
		? '>\n' + str.split('\n').map((line) => `  ${line}`).join('\n')
		: str;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
function main() {
	const args = parseArgs(process.argv.slice(2));
	const source = args.source;
	const output = args.output;
	const name = args.name || basename(source);
	const description = args.description || `Documentation for ${name}. Use when working on ${name}.`;

	if (!statSync(source).isDirectory()) {
		console.error(`[generate-skill] 源目录不存在或不是目录: ${source}`);
		process.exit(1);
	}

	const files = walk(source, source).sort((a, b) => a.rel.localeCompare(b.rel));
	if (files.length === 0) {
		console.error(`[generate-skill] ${source} 下没有找到文档文件。`);
		process.exit(1);
	}

	// 1. 生成 references/（每个文档页一个 .md，补齐 YAML frontmatter）
	const referencesDir = join(output, 'references');
	for (const file of files) {
		const raw = readFileSync(file.full, 'utf8');
		const { title, description: desc, body } = parseFrontmatter(raw);
		const refRel = file.rel.replace(FILE_EXT_RE, '') + '.md';
		const refPath = join(referencesDir, refRel);
		const frontmatter = [
			'---',
			`id: starlight-${toId(file.rel)}`,
			`title: ${yamlFold(title || toId(file.rel))}`,
			`description: ${yamlFold(desc || '')}`,
			'category: reference',
			'---',
			'',
		].join('\n');
		mkdirSync(dirname(refPath), { recursive: true });
		writeFileSync(refPath, frontmatter + (body.startsWith('\n') ? body : '\n' + body));
	}

	// 2. 按顶层目录分组，生成 SKILL.md 页面索引
	const groups = new Map();
	for (const file of files) {
		const parts = file.rel.split('/');
		const group = parts.length > 1 ? parts[0] : '__root__';
		if (!groups.has(group)) groups.set(group, []);
		groups.get(group).push(file);
	}

	const groupLines = [];
	const sortedGroups = [...groups.keys()].sort((a, b) =>
		a === '__root__' ? -1 : b === '__root__' ? 1 : a.localeCompare(b)
	);
	for (const group of sortedGroups) {
		groupLines.push(`### ${group === '__root__' ? '概述' : group}`);
		for (const file of groups.get(group)) {
			const raw = readFileSync(file.full, 'utf8');
			const { title } = parseFrontmatter(raw);
			const refRel = file.rel.replace(FILE_EXT_RE, '') + '.md';
			groupLines.push(`- [${title || toId(file.rel)}](references/${refRel})`);
		}
		groupLines.push('');
	}

	const skill = [
		'---',
		`name: ${name}`,
		`description: ${yamlFold(description)}`,
		'---',
		'',
		`# ${name} 文档`,
		'',
		`本技能包由 Starlight 文档站自动生成。内容来源：\`${source}\`。`,
		'',
		'## 页面索引',
		'',
		...groupLines,
		'## 使用方式',
		'',
		'- 需要查询某个主题时，先读取上方对应分组的 `references/` 文件。',
		'- `references/` 内的文件与文档站的页面一一对应，路径结构保持一致。',
		'- 如要为 AI 增加操作指引（核心约束、速查表、禁止模式），请编辑本文件正文或补充 references 内容。',
		'',
	].join('\n');

	mkdirSync(output, { recursive: true });
	writeFileSync(join(output, 'SKILL.md'), skill);

	console.log(
		`[generate-skill] 完成：${files.length} 个文档页 → ${output}/SKILL.md + references/`
	);
}

main();
