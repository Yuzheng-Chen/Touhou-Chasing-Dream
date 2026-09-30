import type { OfficialCardDef } from './types.js';

const o = (id: string, name: string, subtitle: string, text: string, count = 1): OfficialCardDef => ({
  kind: 'official', id, name, subtitle, count, text,
});

export const OFFICIAL_CARDS: OfficialCardDef[] = [
  o('pofv', '东方花映塚', 'Phantasmagoria of Flower View', '被翻开时立刻进入官作牌弃牌堆，并再翻开一张官作牌。'),
  o('soku', '东方非想天则', 'Touhou Hisoutensoku', '每回合一次，每位玩家可以将一张手牌当作「联机对战」打出。若「东方绯想天」在官作牌弃牌堆中，则同时发动「东方绯想天」的效果。'),
  o('aocf', '东方凭依华', 'Antinomy of Common Flowers', '翻开本牌的玩家指定官作牌弃牌堆中的一张官作牌，本牌效果视为和被指定的官作牌相同。（若本牌为本局游戏中第一张官作牌则本牌无特殊效果）'),
  o('old_works', '旧作', 'PC-98 Era', '无特殊效果。'),
  o('wbawc', '东方鬼形兽', 'Wily Beast and Weakest Creature', '所有玩家在自己的回合内，打出的第3张行动牌视作上一张进入弃牌堆的行动牌的复制。'),
  o('ds', '东方文花帖DS', 'Double Spoiler', '任意玩家的抽牌阶段，该玩家可以放弃抽牌，改为获得另外一名玩家的一张手牌，因此失去手牌的玩家立即抽一张行动牌。'),
  o('ddc', '东方辉针城', 'Double Dealing Character', '所有牌面上对社群规模和个人影响力进行变动的数字翻倍。'),
  o('hm', '东方心绮楼', 'Hopeless Masquerade', '所有影响社群规模的事件牌效果偏移量-1。'),
  o('gfw', '妖精大战争', 'Great Fairy Wars', '任意玩家的回合结束阶段，若该玩家和其相邻两个玩家三人的个人影响力同时为正或同时为负，则该玩家令社群规模±3。'),
  o('swr', '东方绯想天', 'Scarlet Weather Rhapsody', '「联机对战」结算后，发起者用骰子点数+1和目标玩家的骰子点数进行拼点，点数大的一方个人影响力+1，另一方个人影响力-1。若「东方非想天则」在官作牌弃牌堆中，则同时发动「东方非想天则」的效果。'),
  o('sa', '东方地灵殿', 'Subterranean Animism', '每个玩家的回合结束后，若全场个人影响力最高的玩家数量小于等于2，则其可以依次令社群规模±1。'),
  o('isc', '弹幕天邪鬼', 'Impossible Spell Card', '将事件牌堆和行动牌堆正面朝上放置。'),
  o('stb', '东方文花帖', 'Shoot the Bullet', '使用「造谣」时自己不减少个人影响力，使用「挂裱」时自己个人影响力+1。'),
  o('in', '东方永夜抄', 'Imperishable Night', '所有玩家抽牌阶段额外抽一张行动牌。'),
  o('hsifs', '东方天空璋', 'Hidden Star in Four Seasons', '每回合一次，每位玩家在事件获取阶段后，可以弃置当前抽到的事件牌并再抽一张事件牌。'),
  o('vd', '秘封噩梦日记', 'Violet Detector', '所有影响社群规模的事件牌效果偏移量+1。'),
  o('td', '东方神灵庙', 'Ten Desires', '所有个人影响力不为负的玩家的个人影响力均不会因技能或牌的效果降至0以下。'),
  o('eosd', '东方红魔乡', 'Embodiment of Scarlet Devil', '无法使用或发动效果中包含判定动作的行动牌和技能。'),
  o('ufo', '东方星莲船', 'Undefined Fantastic Object', '所有玩家在自己的回合内，使用第三张行动牌时，抽一张行动牌。'),
  o('iamp', '东方萃梦想', 'Immaterial and Missing Power', '任意玩家回合结束时，从弃牌堆里拿回自己本回合中使用过的群体行动牌。'),
  o('lolk', '东方绀珠传', 'Legacy of Lunatic Kingdom', '每位玩家的弃牌阶段执行内容改为该玩家抽牌或弃牌至自己本回合开始时的手牌数。'),
  o('ulil', '东方深秘录', 'Urban Legend in Limbo', '所有玩家在自己回合的事件结算阶段必须选择扣置事件牌。（行动牌「火星」无视本牌效果）'),
  o('pcb', '东方妖妖梦', 'Perfect Cherry Blossom', '任意玩家回合结束阶段，若其手牌数达到手牌数上限，其个人影响力+1。'),
  o('mof', '东方风神录', 'Mountain of Faith', '所有玩家手牌上限+1。'),
];
