// Nerd Font glyphs (https://www.nerdfonts.com/cheat-sheet). They need a Nerd
// Font in the terminal; without one they show as placeholder boxes.

const FOLDER_CLOSED = "\uf07b";
const FOLDER_OPEN = "\uf07c";
const FILE = "\uf15b";

const FOLDERS: Record<string, string> = {
	node_modules: "\ue718",
	".github": "\uf408",
	".vscode": "\ue70c",
};

const NAMES: Record<string, string> = {
	".gitignore": "\ue702",
	".gitattributes": "\ue702",
	".gitmodules": "\ue702",
	dockerfile: "\ue7b0",
	"docker-compose.yml": "\ue7b0",
	"package.json": "\ue71e",
	"package-lock.json": "\uf023",
	"pnpm-lock.yaml": "\uf023",
	"yarn.lock": "\uf023",
	"bun.lockb": "\uf023",
	license: "\uf0e3",
	"license.md": "\uf0e3",
	makefile: "\uf489",
	".env": "\uf462",
};

const EXTENSIONS: Record<string, string> = {
	ts: "\ue628",
	mts: "\ue628",
	cts: "\ue628",
	tsx: "\ue7ba",
	jsx: "\ue7ba",
	js: "\ue74e",
	mjs: "\ue74e",
	cjs: "\ue74e",
	json: "\ue60b",
	jsonc: "\ue60b",
	md: "\ue73e",
	mdx: "\ue73e",
	html: "\ue736",
	css: "\ue749",
	scss: "\ue603",
	py: "\ue73c",
	go: "\ue627",
	rs: "\ue7a8",
	java: "\ue738",
	kt: "\ue634",
	cs: "\uf81a",
	php: "\ue73d",
	rb: "\ue739",
	sh: "\uf489",
	bash: "\uf489",
	zsh: "\uf489",
	ps1: "\uf489",
	yml: "\ue615",
	yaml: "\ue615",
	toml: "\ue615",
	ini: "\ue615",
	xml: "\ue619",
	sql: "\ue706",
	png: "\uf1c5",
	jpg: "\uf1c5",
	jpeg: "\uf1c5",
	gif: "\uf1c5",
	svg: "\uf1c5",
	webp: "\uf1c5",
	ico: "\uf1c5",
	pdf: "\uf1c1",
	zip: "\uf1c6",
	gz: "\uf1c6",
	txt: "\uf15c",
	log: "\uf18d",
	lock: "\uf023",
};

/** The Nerd Font glyph for a path: by folder name, then file name, then extension. */
export function iconFor(name: string, dir: boolean, expanded: boolean): string {
	const lower = name.toLowerCase();
	if (dir) return FOLDERS[lower] ?? (expanded ? FOLDER_OPEN : FOLDER_CLOSED);
	if (NAMES[lower]) return NAMES[lower];
	if (lower.startsWith(".env")) return NAMES[".env"]!;
	const dot = lower.lastIndexOf(".");
	return (dot > 0 && EXTENSIONS[lower.slice(dot + 1)]) || FILE;
}
