import { ACTION_CARDS, EVENT_CARDS, OFFICIAL_CARDS, ROLE_CARDS } from '@tcd/shared';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Card } from '../cards/Card';
import { useStore } from '../store';
import './sheets.css';

export function Sheets() {
  const overlay = useStore((s) => s.overlay);
  const close = () => useStore.getState().setOverlay(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <AnimatePresence>
      {overlay && (
        <motion.div className="sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close}>
          <motion.div className="sheet" initial={{ y: 24, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 16, opacity: 0 }} onClick={(e) => e.stopPropagation()}>
            {overlay === 'rules' ? <Rules onClose={close} /> : <Gallery onClose={close} />}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const TABS = [
  { key: 'role', label: '角色', cards: ROLE_CARDS },
  { key: 'action', label: '行动', cards: ACTION_CARDS },
  { key: 'event', label: '事件', cards: EVENT_CARDS },
  { key: 'official', label: '官作', cards: OFFICIAL_CARDS },
] as const;

function Gallery({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('role');
  const [big, setBig] = useState<string | null>(null);
  const cur = TABS.find((t) => t.key === tab)!;
  return (
    <>
      <div className="sheet__head">
        <h2 className="sheet__title">卡牌图鉴</h2>
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.key} className={`tab ${tab === t.key ? 'is-active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label} <small>{t.cards.length}</small>
            </button>
          ))}
        </div>
        <button className="btn btn--sm sheet__close" onClick={onClose}>关闭</button>
      </div>
      <div className="sheet__body gallery">
        {cur.cards.map((c) => (
          <div key={c.id} className="gallery__item">
            <Card id={c.id} size="md" onClick={() => setBig(c.id)} />
            {'count' in c && c.count > 1 && <span className="gallery__count">×{c.count}</span>}
          </div>
        ))}
      </div>
      <AnimatePresence>
        {big && (
          <motion.div className="gallery__zoom" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setBig(null)}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }}>
              <Card id={big} size="xl" noPreview />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Rules({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="sheet__head">
        <h2 className="sheet__title">规则速览</h2>
        <button className="btn btn--sm sheet__close" onClick={onClose}>关闭</button>
      </div>
      <div className="sheet__body rules">
        <section>
          <h3>目标</h3>
          <p>每位玩家秘密扮演一名角色，角色阵营由两个维度组成：<b className="c-prosper">繁荣</b> / <b className="c-niche">小众</b>，<b>社群</b> / <b>个人</b>。游戏结束时满足阵营胜利条件的玩家得分，得分最高者获胜。</p>
          <table>
            <thead><tr><th>阵营</th><th>胜利条件</th><th>基础得分</th></tr></thead>
            <tbody>
              <tr><td>社群·繁荣</td><td>个人影响力 ≥ 0，社群规模 ≥ 0</td><td>社群规模</td></tr>
              <tr><td>个人·繁荣</td><td>个人影响力 ≥ 0，社群规模 ≥ 0</td><td>个人影响力</td></tr>
              <tr><td>社群·小众</td><td>个人影响力 ≥ 0，社群规模 ≤ 0</td><td>社群规模的绝对值</td></tr>
              <tr><td>个人·小众</td><td>个人影响力 ≥ 0，社群规模 ≤ 0</td><td>个人影响力</td></tr>
              <tr><td>中立</td><td colSpan={2}>见角色技能（需通过技能选择阵营）</td></tr>
            </tbody>
          </table>
          <p className="muted">胜点：得分最高者 2 点（并列时个人影响力最高者），其余得分不为 0 的玩家 1 点。</p>
        </section>

        <section>
          <h3>数值</h3>
          <ul>
            <li><b>社群规模</b>：全场共用，初始 0，范围 −10 ~ +10。</li>
            <li><b>个人影响力</b>：每人一条，初始 0，范围 −5 ~ +5（部分角色可提高上限）。</li>
            <li><b>手牌上限</b> = 个人影响力，最小 1、最大 4。</li>
            <li>所有「±」由发动者决定增加还是减少。</li>
          </ul>
        </section>

        <section>
          <h3>一轮</h3>
          <ol>
            <li><b>官作发布</b>：翻开一张官作牌，本轮持续生效。</li>
            <li>从第一名玩家开始，每人依次进行回合。</li>
            <li><b>官作弃置</b>：本轮官作进入官作弃牌堆。官作弃牌堆达到 <b>12 − 玩家数</b> 张时进入最终结算。</li>
          </ol>
        </section>

        <section>
          <h3>你的回合</h3>
          <ol>
            <li><b>事件获取</b>：抽一张事件牌作为本回合事件牌（抽到「大病一场」立即结束回合）。</li>
            <li><b>摸牌</b>：抽一张行动牌。</li>
            <li><b>行动</b>：打出任意数量的行动牌、发动技能。</li>
            <li><b>事件结算</b>：选择 <em>打出</em>（决定正向/逆向并结算）或 <em>扣置</em>。已有扣置牌时，须先把它正向打出才能扣置新牌；扣置的牌只能正向打出。</li>
            <li><b>弃牌</b>：弃到手牌上限。</li>
          </ol>
        </section>

        <section>
          <h3>判定</h3>
          <ul>
            <li><b>真假判定</b>：1/3/5 为真，2/4/6 为假。</li>
            <li><b>两点点数判定</b>：1-2 → 0，3-4 → 1，5-6 → 2。</li>
            <li><b>增减判定</b>：1→−3，2→−2，3→−1，4→+1，5→+2，6→+3。</li>
          </ul>
        </section>

        <section>
          <h3>角色与技能</h3>
          <p>角色牌开局扣置。发动<b>主动技能</b>会翻开角色牌；<b>被动技能</b>只在角色牌正面向上时生效。</p>
        </section>

        <section>
          <h3>最终结算</h3>
          <p>从最后一名玩家开始逆时针，每人翻开扣置的事件牌并正向结算（最后一张官作仍然有效，所有人不能使用手牌和技能），然后计算得分。</p>
        </section>

        <section>
          <h3>小贴士</h3>
          <ul>
            <li>把鼠标悬停在任意卡牌或日志中的「卡名」上可查看完整效果。</li>
            <li>「挂裱」「墨菲定律」等响应牌会在时机到来时自动询问你是否使用。</li>
            <li>断线后用同一浏览器打开网站即可回到原座位。</li>
          </ul>
        </section>
      </div>
    </>
  );
}
