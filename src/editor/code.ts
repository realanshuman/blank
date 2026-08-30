import {
  HighlightStyle,
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
} from '@codemirror/language'
import { tags } from '@lezer/highlight'

/**
 * Languages for fenced code blocks.
 *
 * Every grammar is behind a dynamic import, so a page with no code fence never
 * downloads a single byte of any of them. That is the whole design rule here:
 * someone who writes prose should not pay, in bundle size or in visible
 * interface, for a feature they never invoke. The app has no code mode to turn
 * on; typing three backticks is the only thing that summons any of this.
 */
export const codeLanguages: LanguageDescription[] = [
  LanguageDescription.of({
    name: 'javascript',
    alias: ['js', 'jsx', 'mjs', 'cjs', 'node'],
    extensions: ['js', 'jsx', 'mjs', 'cjs'],
    load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true })),
  }),
  LanguageDescription.of({
    name: 'typescript',
    alias: ['ts', 'tsx'],
    extensions: ['ts', 'tsx'],
    load: () =>
      import('@codemirror/lang-javascript').then((m) =>
        m.javascript({ typescript: true, jsx: true }),
      ),
  }),
  LanguageDescription.of({
    name: 'python',
    alias: ['py'],
    extensions: ['py'],
    load: () => import('@codemirror/lang-python').then((m) => m.python()),
  }),
  LanguageDescription.of({
    name: 'rust',
    alias: ['rs'],
    extensions: ['rs'],
    load: () => import('@codemirror/lang-rust').then((m) => m.rust()),
  }),
  LanguageDescription.of({
    name: 'json',
    extensions: ['json'],
    load: () => import('@codemirror/lang-json').then((m) => m.json()),
  }),
  LanguageDescription.of({
    name: 'html',
    alias: ['htm'],
    extensions: ['html', 'htm'],
    load: () => import('@codemirror/lang-html').then((m) => m.html()),
  }),
  LanguageDescription.of({
    name: 'css',
    extensions: ['css'],
    load: () => import('@codemirror/lang-css').then((m) => m.css()),
  }),
  LanguageDescription.of({
    // Shell has no first-party package, so it comes from the legacy modes,
    // wrapped to look like every other language to CodeMirror.
    name: 'shell',
    alias: ['sh', 'bash', 'zsh', 'console', 'terminal'],
    extensions: ['sh', 'bash'],
    load: () =>
      import('@codemirror/legacy-modes/mode/shell').then(
        (m) => new LanguageSupport(StreamLanguage.define(m.shell)),
      ),
  }),
]

/**
 * Syntax colours for the inside of a code block.
 *
 * Deliberately few hues. This is a page for writing on, and an editor palette
 * with nine colours on it reads as somebody else's IDE dropped into the middle
 * of your notes. Comments recede, strings and keywords separate, everything
 * else is body text. All of it resolves through theme tokens, so it follows
 * light, sepia, dark and black without a second definition.
 */
export const codeHighlight = HighlightStyle.define([
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--blank-code-comment)', fontStyle: 'italic' },
  { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword, tags.operatorKeyword], color: 'var(--blank-code-keyword)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--blank-code-string)' },
  // Not tags.atom: markdown tokenises a task list's [ ] marker as an atom, so
  // including it here paints code colours onto prose, which is exactly the
  // leak these features are supposed to avoid.
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--blank-code-number)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.definition(tags.function(tags.variableName))], color: 'var(--blank-code-name)' },
  { tag: [tags.typeName, tags.className, tags.tagName, tags.namespace], color: 'var(--blank-code-name)' },
  { tag: [tags.attributeName, tags.propertyName], color: 'var(--blank-code-attr)' },
  { tag: [tags.operator, tags.punctuation, tags.separator, tags.bracket], color: 'var(--blank-muted)' },
  { tag: tags.invalid, color: 'var(--blank-danger)' },
])
