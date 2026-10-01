import {
  ACTION_CARDS, ACTION_CATEGORY_LABEL, EVENT_CARDS, FOCUS_LABEL, OFFICIAL_CARDS, ROLE_CARDS, STANCE_LABEL, cardText,
  type CardDef, type CardKind,
} from '@tcd/shared';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, KIND_LABEL } from '../cards/Card';
import { GlossList } from '../ui/GlossList';

/** Card gallery: browse every card, search names / effects / keywords, filter by group, sort. */

interface Entry {
  id: string;
  kind: CardKind;
  name: string;
  count: number;
  /** Category (action), topic (event) or faction (role); '' for officials. */
  group: string;
  /** Position in the catalogue, for "default" order and group order. */
  order: number;
  haystack: string;
}

const groupOf = (d: CardDef): string => {
  switch (d.kind) {
    case 'action': return ACTION_CATEGORY_LABEL[d.category];
    case 'event': return d.shape === 'chain' ? `连锁·${d.topic}` : d.topic;
    case 'role': return d.stance === 'neutral' ? '中立' : `${FOCUS_LABEL[d.focus]}·${STANCE_LABEL[d.stance]}`;
    case 'official': return '';
  }
};

const ENTRIES: Entry[] = [...ROLE_CARDS, ...ACTION_CARDS, ...EVENT_CARDS, ...OFFICIAL_CARDS].map((d, order) => {
  const group = groupOf(d);
  const extra = d.kind === 'official' ? `${d.subtitle ?? ''}` : d.kind === 'role' ? `${d.flavor ?? ''}` : '';
  return {
    id: d.id, kind: d.kind, name: d.name, count: 'count' in d ? d.count : 1, group, order,
    haystack: `${d.name} ${KIND_LABEL[d.kind]} ${group} ${cardText(d)} ${extra} ${d.id}`.toLowerCase(),
  };
});

const TABS: { key: CardKind | 'all'; label: string }[] = [
  { key: 'role', label: '角色' },
  { key: 'action', label: '行动' },
  { key: 'event', label: '事件' },
  { key: 'official', label: '官作' },
  { key: 'all', label: '全部' },
];

type Sort = 'default' | 'name' | 'count' | 'group';
const SORTS: { key: Sort; label: string }[] = [
  { key: 'default', label: '默认' },
  { key: 'name', label: '名称' },
  { key: 'count', label: '张数' },
  { key: 'group', label: '类别' },
];

const collator = new Intl.Collator('zh-Hans-CN');

export function Gallery({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<CardKind | 'all'>('role');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('default');
  const [group, setGroup] = useState<string | null>(null);
  const [big, setBig] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // "/" jumps to the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== input.current) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const tokens = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query]);
  const matches = useMemo(() => ENTRIES.filter((e) => tokens.every((t) => e.haystack.includes(t))), [tokens]);
  const countOf = (k: CardKind | 'all') => (k === 'all' ? matches.length : matches.filter((e) => e.kind === k).length);

  const inTab = useMemo(() => matches.filter((e) => tab === 'all' || e.kind === tab), [matches, tab]);
  // Group chips: the groups present in this tab, in catalogue order, with how many cards each holds.
  const groups = useMemo(() => {
    const seen = new Map<string, number>();
    for (const e of inTab) if (e.group) seen.set(e.group, (seen.get(e.group) ?? 0) + 1);
    return [...seen.entries()];
  }, [inTab]);
  useEffect(() => setGroup(null), [tab]);

  const shown = useMemo(() => {
    const list = inTab.filter((e) => !group || e.group === group);
    const groupRank = new Map(groups.map(([g], i) => [g, i]));
    switch (sort) {
      case 'name': return [...list].sort((a, b) => collator.compare(a.name, b.name));
      case 'count': return [...list].sort((a, b) => b.count - a.count || a.order - b.order);
      case 'group': return [...list].sort((a, b) => (groupRank.get(a.group) ?? 99) - (groupRank.get(b.group) ?? 99) || a.order - b.order);
      default: return list;
    }
  }, [inTab, group, sort, groups]);

  return (
    <>
      <div className="sheet__head">
        <h2 className="sheet__title">卡牌图鉴</h2>
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.key} className={`tab ${tab === t.key ? 'is-active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label} <small>{countOf(t.key)}</small>
            </button>
          ))}
        </div>
        <button className="btn btn--sm sheet__close" onClick={onClose}>关闭</button>
      </div>
      <div className="sheet__body gallery">
        <div className="gallery__bar">
          <label className="gsearch">
            <span aria-hidden>🔍</span>
            <input
              ref={input}
              type="text"
              value={query}
              placeholder="搜索名称、效果、关键词……（按 / 聚焦）"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && query) {
                  e.stopPropagation();
                  setQuery('');
                }
              }}
            />
            {query && <button type="button" className="gsearch__clear" aria-label="清除搜索" onClick={() => { setQuery(''); input.current?.focus(); }}>×</button>}
          </label>
          <div className="gsort" role="radiogroup" aria-label="排序">
            <span>排序</span>
            {SORTS.map((s) => (
              <button key={s.key} type="button" role="radio" aria-checked={sort === s.key} className={sort === s.key ? 'is-on' : ''} onClick={() => setSort(s.key)}>{s.label}</button>
            ))}
          </div>
          {groups.length > 1 && (
            <div className="gchips">
              <button type="button" className={group === null ? 'is-on' : ''} onClick={() => setGroup(null)}>全部 <small>{inTab.length}</small></button>
              {groups.map(([g, n]) => (
                <button key={g} type="button" className={group === g ? 'is-on' : ''} onClick={() => setGroup(group === g ? null : g)}>{g} <small>{n}</small></button>
              ))}
            </div>
          )}
        </div>

        {shown.length === 0 ? (
          <p className="gallery__empty">没有找到匹配的卡牌。试试别的关键词，或者换一个分类。</p>
        ) : (
          <div className="gallery__grid">
            {shown.map((e) => (
              <div key={e.id} className="gallery__item">
                <Card id={e.id} size="md" onClick={() => setBig(e.id)} />
                {e.count > 1 && <span className="gallery__count">×{e.count}</span>}
                {tab === 'all' && <span className="gallery__kind">{KIND_LABEL[e.kind]}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
      <AnimatePresence>
        {big && (
          <motion.div className="gallery__zoom" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setBig(null)}>
            <motion.div className="gallery__zoomrow" initial={{ scale: 0.92 }} animate={{ scale: 1 }}>
              <Card id={big} size="xl" noPreview />
              <GlossList id={big} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
