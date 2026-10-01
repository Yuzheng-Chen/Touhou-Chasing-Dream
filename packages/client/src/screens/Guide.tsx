import { motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { Card } from '../cards/Card';
import { request } from '../net';
import { useStore } from '../store';
import './guide.css';

/**
 * Illustrated rules. Designed so a newcomer can read the tabs top to bottom in ~3 minutes, then jump
 * into the coached tutorial game. Everything uses the real card components so what they learn matches the table.
 */
const TABS = [
  { key: 'goal', label: '目标' },
  { key: 'turn', label: '一轮怎么玩' },
  { key: 'cards', label: '四种牌' },
  { key: 'numbers', label: '数值与骰子' },
  { key: 'tips', label: '技巧' },
] as const;
type Tab = (typeof TABS)[number]['key'];

export function Guide({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('goal');
  const room = useStore((s) => s.room);
  const connected = useStore((s) => s.connected);
  const toast = useStore((s) => s.toast);
  const name = useStore((s) => s.name);

  const tutorial = async () => {
    if (!name) return toast('先在首页起一个昵称吧', 'bad');
    try {
      await request('room:tutorial');
      onClose();
    } catch (e) {
      toast(String(e), 'bad');
    }
  };

  return (
    <>
      <div className="sheet__head">
        <h2 className="sheet__title">新手指南</h2>
        <div className="tabs guide__tabs">
          {TABS.map((t) => (
            <button key={t.key} className={`tab ${tab === t.key ? 'is-active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>
        <button className="btn btn--sm sheet__close" onClick={onClose}>关闭</button>
      </div>

      <div className="sheet__body guide">
        {!room && (
          <div className="guide__cta">
            <div>
              <b>🎓 想边玩边学？</b>
              <span>教学局：你 + 2 位 AI，只打 3 轮，旁边有提示一步步带你走。约 8 分钟。</span>
            </div>
            <button className="btn btn--gold" disabled={!connected} onClick={tutorial}>开始教学局</button>
          </div>
        )}
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
          {tab === 'goal' && <Goal />}
          {tab === 'turn' && <Turn />}
          {tab === 'cards' && <Kinds />}
          {tab === 'numbers' && <Numbers />}
          {tab === 'tips' && <Tips />}
        </motion.div>
      </div>
    </>
  );
}

// ── 目标 ───────────────────────────────────────────────────────────────────────

function ZoneBar({ side }: { side: 'prosper' | 'niche' | 'both' }) {
  return (
    <div className="zbar" aria-hidden>
      <div className={`zbar__good zbar__good--${side}`} />
      <i className="zbar__mid" />
      <span className="zbar__l">小众 −10</span>
      <span className="zbar__r">+10 繁荣</span>
    </div>
  );
}

const FACTIONS: { name: string; stance: 'prosper' | 'niche'; focus: string; wish: string; score: string; roles: string[] }[] = [
  { name: '社群 · 繁荣', stance: 'prosper', focus: '社群', wish: '东方越火越好，更在乎整个圈子的大小。', score: '得分 = 社群规模', roles: ['evangelist', 'platform_op'] },
  { name: '个人 · 繁荣', stance: 'prosper', focus: '个人', wish: '圈子要大，但更想自己出名。', score: '得分 = 个人影响力', roles: ['popular_creator', 'freeloader'] },
  { name: '社群 · 小众', stance: 'niche', focus: '社群', wish: '宁缺毋滥，圈子小而精才好。', score: '得分 = 社群规模的绝对值', roles: ['touhou_police', 'doomsayer'] },
  { name: '个人 · 小众', stance: 'niche', focus: '个人', wish: '不在乎圈子大小，专注自己的作品与名气。', score: '得分 = 个人影响力', roles: ['niche_lover', 'oshi'] },
];

function Goal() {
  return (
    <div className="g-stack">
      <p className="g-lead">
        每位玩家<b>秘密</b>扮演一个角色。角色有立场：想让<em className="c-prosper">社群规模 ＞ 0（繁荣）</em>，还是想让它
        <em className="c-niche">＜ 0（小众）</em>？而<b>个人影响力</b>永远不能为负。游戏结束时，满足自己条件的人得分，分高者获胜。
      </p>
      <div className="g-meters">
        <Mini title="社群规模" text="全场共用，−10 ~ +10。大家的牌都在推它。" />
        <Mini title="个人影响力" text="每人一条，−5 ~ +5。想获胜它必须 ≥ 0。" />
        <Mini title="胜点" text="得分最高者 2 点，其余有得分者 1 点。" />
      </div>
      <div className="g-factions">
        {FACTIONS.map((f) => (
          <div key={f.name} className={`faction faction--${f.stance}`}>
            <div className="faction__name">{f.name}</div>
            <ZoneBar side={f.stance} />
            <p className="faction__wish">{f.wish}</p>
            <ul>
              <li>个人影响力 ≥ 0</li>
              <li>社群规模 {f.stance === 'prosper' ? '≥ 0' : '≤ 0'}</li>
              <li className="faction__score">{f.score}</li>
            </ul>
            <div className="faction__roles">{f.roles.map((r) => <Card key={r} id={r} size="xs" />)}</div>
          </div>
        ))}
        <div className="faction faction--neutral">
          <div className="faction__name">中立</div>
          <ZoneBar side="both" />
          <p className="faction__wish">没有固定立场，要靠技能选择阵营或跟随别人。</p>
          <ul><li>狂热粉丝：胜利条件跟偶像一样</li><li>一般路过爱好者：随时站队</li></ul>
          <div className="faction__roles">{['zealot', 'passerby'].map((r) => <Card key={r} id={r} size="xs" />)}</div>
        </div>
      </div>
      <p className="g-note">角色牌开局扣着。<b>发动主动技能会自动翻开</b>，之后全桌都知道你的立场——藏好，或者择机亮明。</p>
    </div>
  );
}

function Mini({ title, text }: { title: string; text: string }) {
  return (
    <div className="mini">
      <b>{title}</b>
      <span>{text}</span>
    </div>
  );
}

// ── 一轮 ───────────────────────────────────────────────────────────────────────

const ROUND = [
  { t: '官作发布', d: '翻开一张官作牌，本轮全场生效。' },
  { t: '每人一个回合', d: '从第一名玩家开始，顺时针各打一个回合。' },
  { t: '官作弃置', d: '官作进入弃牌堆。堆够张数后进入最终结算。' },
];
const TURN = [
  { t: '事件获取', d: '抽一张事件牌。', tip: '抽到「大病一场」立刻结束回合。' },
  { t: '摸牌', d: '抽一张行动牌。', tip: '有些官作会多摸。' },
  { t: '行动', d: '打出任意张行动牌，发动技能。', tip: '点亮起的手牌即可。' },
  { t: '事件结算', d: '打出事件牌并选正/逆向，或扣置。', tip: '扣置的事件最终结算才发动。' },
  { t: '弃牌', d: '弃到手牌上限（= 个人影响力，1~4）。', tip: '影响力高，拿得多。' },
];

function Turn() {
  return (
    <div className="g-stack">
      <h4>一轮</h4>
      <div className="flow">
        {ROUND.map((s, i) => (
          <div key={s.t} className="flow__step" style={{ '--i': i } as React.CSSProperties}>
            <b>{i + 1}</b>
            <div><strong>{s.t}</strong><span>{s.d}</span></div>
          </div>
        ))}
      </div>
      <h4>你的回合</h4>
      <div className="flow flow--turn">
        {TURN.map((s, i) => (
          <div key={s.t} className="flow__step" style={{ '--i': i } as React.CSSProperties}>
            <b>{i + 1}</b>
            <div><strong>{s.t}</strong><span>{s.d}</span><em>{s.tip}</em></div>
          </div>
        ))}
      </div>
      <div className="callout">
        <b>最终结算</b>官作弃牌堆达到「12 − 人数」张（房主可改）后，该轮结束即进入最终结算：从最后一名玩家起逆时针，每人把<b>扣置的事件牌</b>正向打出，期间不能用手牌和技能。然后计分。
      </div>
    </div>
  );
}

// ── 四种牌 ─────────────────────────────────────────────────────────────────────

function Kinds() {
  const items: { id: string; title: string; body: ReactNode }[] = [
    { id: 'preach', title: '行动牌 · 红色圆角', body: <>你的手牌。行动阶段打出，推动数值。左上角标着<b>「行动」</b>，右上角是细分类型（即时 / 判定 / 群体 / 延时 / 响应…）。</> },
    { id: 'headline', title: '事件牌 · 蓝色拱形', body: <>每回合抽一张，是命运。顶部飘带写着<b>「事件」</b>，底部<b>正</b>/<b>逆</b>两个方向。不算手牌。</> },
    { id: 'pcb', title: '官作牌 · 金色横版', body: <>每轮翻一张，全场生效；也用来数轮数。左上角写着<b>「官作」</b>。</> },
    { id: 'evangelist', title: '角色牌 · 竖排名字', body: <>你的秘密身份，决定立场和技能。左侧竖排角色名，右上角是<b>「角色」</b>标签。</> },
  ];
  return (
    <div className="g-stack">
      <div className="kinds">
        {items.map((k) => (
          <div key={k.id} className="kind">
            <Card id={k.id} size="md" />
            <div><h4>{k.title}</h4><p>{k.body}</p></div>
          </div>
        ))}
      </div>
      <div className="callout callout--warn">
        <b>别搞混</b>
        部分行动牌右上角写着「改事件」（如消息灵通、火星）。那只是说它们能<b>操作事件牌</b>，它们依然是<b>红色圆角的行动牌</b>。
        事件牌永远是<b>蓝色拱形</b>，且带有 正 / 逆 标记。
      </div>
      <h4>事件牌怎么读</h4>
      <div className="anatomy">
        <Card id="national_event" size="lg" noPreview />
        <ul>
          <li><b>正向</b>：事件顺利发生。<b>逆向</b>：没按预期发生。通常由<b>打出者决定</b>。</li>
          <li><b>扣置</b>：压在面前先不发动，之后只能正向，且无法被「选择方向」的效果干预；最终结算时一并发动。</li>
          <li><b>无向</b>事件没有选择，打出就生效（例：大病一场、文化自信）。</li>
          <li><b>连锁</b>事件进入连锁区，后续同类事件会联动（例：人气投票、遍地开花）。</li>
        </ul>
      </div>
    </div>
  );
}

// ── 数值与骰子 ─────────────────────────────────────────────────────────────────

const DICE: { name: string; rows: string[] }[] = [
  { name: '真假判定', rows: ['1·3·5 → 真', '2·4·6 → 假'] },
  { name: '两点点数判定', rows: ['1·2 → 0', '3·4 → 1', '5·6 → 2'] },
  { name: '增减判定', rows: ['1 → −3', '2 → −2', '3 → −1', '4 → +1', '5 → +2', '6 → +3'] },
];

function Numbers() {
  return (
    <div className="g-stack">
      <div className="g-meters g-meters--big">
        <div className="mini">
          <b>社群规模</b>
          <div className="zbar zbar--wide" aria-hidden><div className="zbar__good zbar__good--both" /><i className="zbar__mid" /><span className="zbar__l">−10</span><span className="zbar__r">+10</span></div>
          <span>卡牌上的「±N」由<b>发动者</b>决定增加还是减少。</span>
        </div>
        <div className="mini">
          <b>个人影响力</b>
          <span>初始 0，上下限 ±5（部分角色可提高）。小于 0 的玩家<b>无法获胜</b>。</span>
        </div>
        <div className="mini">
          <b>手牌上限</b>
          <span>= 个人影响力，但至少 1、至多 4。回合末超出就要弃牌。</span>
        </div>
      </div>
      <h4>骰子判定</h4>
      <div className="dice">
        {DICE.map((d) => (
          <div key={d.name} className="dice__card">
            <b>{d.name}</b>
            <div>{d.rows.map((r) => <span key={r}>{r}</span>)}</div>
          </div>
        ))}
      </div>
      <p className="g-note">官作「东方红魔乡」会禁止一切判定：需要判定的行动牌无法打出。</p>
    </div>
  );
}

// ── 技巧 ───────────────────────────────────────────────────────────────────────

function Tips() {
  return (
    <div className="g-stack">
      <div className="tips">
        <div><b>🔍 悬停看牌</b>鼠标放在任意牌上，或点日志里的「卡名」，会弹出大图和术语解释（手机上长按）。</div>
        <div><b>🛡 响应牌</b>挂裱、墨菲定律会在可用的时机自动问你，不用主动找。</div>
        <div><b>🕵 隐藏身份</b>别太早翻开角色牌；但有的被动技能必须翻开才生效。</div>
        <div><b>🤖 掉线不怕</b>离开一会儿会由 AI 托管，回来点一下就接手。</div>
        <div><b>💬 表情</b>牌桌上点 😀 可以发送表情，在你的座位上方冒泡。</div>
      </div>
      <h4>键盘快捷键（牌桌）</h4>
      <div className="keys">
        <span><kbd>空格</kbd> 结束行动</span>
        <span><kbd>1</kbd>–<kbd>9</kbd> 打出第 N 张手牌</span>
        <span><kbd>Esc</kbd> 关闭窗口</span>
        <span><kbd>L</kbd> 战况 / 聊天</span>
      </div>
    </div>
  );
}
