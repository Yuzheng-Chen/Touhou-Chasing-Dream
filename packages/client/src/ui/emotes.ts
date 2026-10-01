/** Quick reactions. Ids are validated by the server (see EMOTES in rooms.ts). */
export const EMOTES: Record<string, { glyph: string; label: string }> = {
  thumbs: { glyph: '👍', label: '赞' },
  clap: { glyph: '👏', label: '鼓掌' },
  laugh: { glyph: '😂', label: '哈哈' },
  cool: { glyph: '😎', label: '帅' },
  think: { glyph: '🤔', label: '嗯…' },
  wait: { glyph: '⏳', label: '快点' },
  cry: { glyph: '😭', label: '呜呜' },
  fire: { glyph: '🔥', label: '燃' },
};
