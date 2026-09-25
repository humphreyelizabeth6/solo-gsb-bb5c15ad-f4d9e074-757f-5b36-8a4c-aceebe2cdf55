'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'stage.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS locations (
  name       TEXT PRIMARY KEY,
  unlimited  INTEGER NOT NULL DEFAULT 0   -- 1 = 后台，容量不限；0 = 普通区位，最多一件道具
);

CREATE TABLE IF NOT EXISTS props (
  name       TEXT PRIMARY KEY,
  location   TEXT NOT NULL REFERENCES locations(name)
);

CREATE TABLE IF NOT EXISTS cues (
  number     INTEGER PRIMARY KEY,          -- 提示号，唯一，重放按它升序
  note       TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS transfers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cue_number INTEGER NOT NULL REFERENCES cues(number) ON DELETE CASCADE,
  prop       TEXT NOT NULL,
  from_loc   TEXT NOT NULL,
  to_loc     TEXT NOT NULL,
  UNIQUE (cue_number, prop)                -- 同组内每件道具最多转移一次
);

CREATE TABLE IF NOT EXISTS crew (
  name       TEXT PRIMARY KEY              -- 换景工作人员，rowid 即维护/匹配顺序
);

CREATE TABLE IF NOT EXISTS crew_qualifications (
  crew_name  TEXT NOT NULL REFERENCES crew(name) ON DELETE CASCADE,
  prop       TEXT NOT NULL REFERENCES props(name) ON DELETE CASCADE,
  PRIMARY KEY (crew_name, prop)            -- 某人可搬运某道具的资格
);
`);

// 首次启动时写入示例数据（区位 / 道具 / 三条提示，其中 30 号故意与 20 号冲突，用于演示整组不生效）
function seed() {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM locations').get();
  if (c > 0) return;

  const tx = db.transaction(() => {
    const insLoc = db.prepare('INSERT INTO locations (name, unlimited) VALUES (?, ?)');
    insLoc.run('后台', 1);
    for (const name of ['舞台左', '舞台右', '舞台中央', '高台']) insLoc.run(name, 0);

    const insProp = db.prepare('INSERT INTO props (name, location) VALUES (?, ?)');
    insProp.run('桌子', '舞台中央');
    insProp.run('花瓶', '舞台左');
    insProp.run('宝剑', '后台');
    insProp.run('屏风', '后台');
    insProp.run('椅子', '后台');

    const insCue = db.prepare('INSERT INTO cues (number, note) VALUES (?, ?)');
    const insTr = db.prepare(
      'INSERT INTO transfers (cue_number, prop, from_loc, to_loc) VALUES (?, ?, ?, ?)'
    );

    insCue.run(10, '一幕开场：桌子与屏风互换（同组互换区位）');
    insTr.run(10, '屏风', '后台', '舞台中央');
    insTr.run(10, '桌子', '舞台中央', '后台');

    insCue.run(20, '侠客持剑上场');
    insTr.run(20, '宝剑', '后台', '舞台右');

    insCue.run(30, '花瓶移至台右（示例：与 20 号提示冲突，整组不生效）');
    insTr.run(30, '花瓶', '舞台左', '舞台右');

    // 换景人员与搬运资格：10 号提示两条转移，张三、李四需整体匹配（若按转移顺序贪心，
    // 张三先搬了屏风，桌子便无人可搬——服务端必须对整组求完整匹配，不能贪心）；
    // 20 号提示的宝剑无人有资格，演示「人手不足 + 标出未覆盖道具」
    const insCrew = db.prepare('INSERT INTO crew (name) VALUES (?)');
    const insQual = db.prepare('INSERT INTO crew_qualifications (crew_name, prop) VALUES (?, ?)');
    insCrew.run('张三');
    insCrew.run('李四');
    insCrew.run('王五');
    insQual.run('张三', '屏风');
    insQual.run('张三', '桌子');
    insQual.run('李四', '屏风');
    insQual.run('王五', '花瓶');
  });
  tx();
  console.log('[db] 已写入示例数据');
}

seed();

module.exports = db;
