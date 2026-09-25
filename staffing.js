'use strict';

/**
 * 换景人员分配（岗位表计算）。
 *
 * 以现有重放结果为准：
 *  - 仅对「整组生效」的提示分配人员；整组未生效（或重放中已跳过）的提示标为
 *    status = 'skipped'（无需执行），不产生岗位表；
 *  - 生效组内每条道具转移占一个同时执行的岗位，岗位之间并行；
 *  - 每人在同组最多承担一岗；
 *  - 承担某条转移的人必须具备该转移道具的搬运资格。
 *
 * 服务端对整组求「完整匹配」（转移 ↔ 工作人员的二分图完备匹配），
 * 不能按转移录入顺序贪心分配：只要存在完整匹配，贪心也可能因先到先得而失败。
 * 无解时整组标为 status = 'understaffed'（人手不足），列出未覆盖道具，
 * 不输出部分岗位表（posts 恒为空）。
 *
 * 人员资格或提示变化后，调用方应以最新数据重新调用本函数重算全部岗位表。
 *
 * @param {Array<{number:number, ok:boolean, transfers:Array}>} replayResults 现有重放结果
 * @param {Array<{number:number, note:string, transfers:Array<{prop:string,from:string,to:string}>}>} cues 提示（含转移，按提示号升序）
 * @param {Array<{name:string, props:string[]}>} crew 工作人员及其可搬运道具名单（按维护顺序）
 * @returns {{results: Array}}
 *   status: 'staffed'（已完整排岗）| 'understaffed'（人手不足，无岗位表）| 'skipped'（无需执行）
 */
function buildStaffing(replayResults, cues, crew) {
  // 道具 -> 有搬运资格的人员（按 crew 维护顺序，保证匹配结果确定）
  const qualifiedByProp = new Map();
  for (const member of crew) {
    for (const prop of member.props) {
      if (!qualifiedByProp.has(prop)) qualifiedByProp.set(prop, []);
      qualifiedByProp.get(prop).push(member.name);
    }
  }

  const replayByNumber = new Map(replayResults.map((r) => [r.number, r]));
  const results = [];

  for (const cue of cues) {
    const replay = replayByNumber.get(cue.number);
    if (!replay || !replay.ok) {
      // 失败提示无需执行：不排岗
      results.push({ number: cue.number, note: cue.note, status: 'skipped', transfers: cue.transfers, posts: [], uncoveredProps: [] });
      continue;
    }

    // Kuhn 增广路算法求「转移 -> 人员」的完整匹配
    // （每人同组最多一岗 = 匹配中每个人员至多出现一次；
    //   某条转移只能连到有该道具资格的人）。按转移录入顺序取增广路，
    //   增广回溯会自动调整先前的占用，因此不会发生贪心式的先到先得失败。
    const assignee = new Map();   // 转移下标 -> 人员
    const ownerOf = new Map();    // 人员 -> 当前占用的转移下标

    const tryAssign = (i, tried) => {
      const candidates = qualifiedByProp.get(cue.transfers[i].prop) || [];
      for (const person of candidates) {
        if (tried.has(person)) continue;
        tried.add(person);
        const occupied = ownerOf.has(person) ? ownerOf.get(person) : -1;
        if (occupied === -1 || tryAssign(occupied, tried)) {
          ownerOf.set(person, i);
          assignee.set(i, person);
          return true;
        }
      }
      return false;
    };

    let complete = true;
    for (let i = 0; i < cue.transfers.length; i++) {
      if (!tryAssign(i, new Set())) { complete = false; break; }
    }

    if (!complete) {
      // 无完整匹配：整组人手不足，标出无法覆盖的道具，不输出部分岗位表
      const covered = new Set([...ownerOf.values()]);
      const uncoveredProps = cue.transfers
        .map((t, i) => (covered.has(i) ? null : t.prop))
        .filter((p) => p !== null);
      results.push({ number: cue.number, note: cue.note, status: 'understaffed', transfers: cue.transfers, posts: [], uncoveredProps });
    } else {
      const posts = cue.transfers.map((t, i) => ({
        prop: t.prop,
        from: t.from,
        to: t.to,
        person: assignee.get(i),
      }));
      results.push({ number: cue.number, note: cue.note, status: 'staffed', transfers: cue.transfers, posts, uncoveredProps: [] });
    }
  }

  return { results };
}

module.exports = { buildStaffing };
