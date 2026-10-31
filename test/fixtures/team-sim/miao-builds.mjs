/** 合成夹具：结构来自miao Avatar/Artis公开字段；不含真实账号/游戏倍率，不作为实测。 */
export function miaoAvatarFixture(index = 0) {
  const sets = [['甲套','甲套','甲套','甲套','散件'], ['甲套','甲套','乙套','乙套','散件'], ['甲','乙','丙','丁','戊'], ['乙套','乙套','乙套','乙套','散件']][index]
  // mainId 取自 miao mainIdMap 的真实部位id：花14001 / 羽12001 / 沙10004 / 杯15013 / 冠13008。
  // 五星满级圣遗物在游戏内恒为4条副词条、共8次强化，夹具按此给足，避免用不合法数据当正例。
  const rows = [
    { main: { id: 14001, key: 'hpPlus', value: 4780 }, attrs: [{ key: 'cpct', value: 7, upNum: 2 }, { key: 'cdmg', value: 14, upNum: 2 }, { key: 'atk', value: 4.7, upNum: 3 }, { key: 'mastery', value: 19, upNum: 1 }], attrIds: [1, 1, 2, 2, 3, 3, 3, 4] },
    { main: { id: 12001, key: 'atkPlus', value: 311 }, attrs: [{ key: 'hp', value: 5.8, upNum: 1 }, { key: 'atk', value: 4.7, upNum: 2 }, { key: 'cpct', value: 3.5, upNum: 3 }, { key: 'cdmg', value: 7, upNum: 2 }], attrIds: [5, 6, 6, 7, 7, 7, 8, 8] },
    { main: { id: 10004, key: 'atk', value: 46.6 }, attrs: [{ key: 'mastery', value: 20, upNum: 1 }, { key: 'cpct', value: 3.5, upNum: 3 }, { key: 'cdmg', value: 7, upNum: 2 }, { key: 'def', value: 5.1, upNum: 2 }], attrIds: [9, 10, 10, 10, 11, 11, 12, 12] },
    { main: { id: 15013, key: 'geo', value: 46.6 }, attrs: [{ key: 'recharge', value: 10, upNum: 2 }, { key: 'hp', value: 4.7, upNum: 2 }, { key: 'atk', value: 4.7, upNum: 2 }, { key: 'cpct', value: 3.5, upNum: 2 }], attrIds: [13, 13, 14, 14, 15, 15, 16, 16] },
    { main: { id: 13008, key: 'cdmg', value: 62.2 }, attrs: [{ key: 'cpct', value: 3.5, upNum: 3 }, { key: 'atk', value: 4.7, upNum: 2 }, { key: 'mastery', value: 19, upNum: 2 }, { key: 'recharge', value: 5.2, upNum: 1 }], attrIds: [17, 17, 17, 18, 18, 19, 19, 20] }
  ].map((row, i) => ({ name: `合成部位${i}`, set: sets[i], level: 20, star: 5, ...row, mainId: row.main.id }))
  const id = 10000000 + index
  return {
    game: 'gs', id, name: `合成角色${index}`, char: { id, name: `合成角色${index}` }, elem: ['geo','hydro','pyro','electro'][index],
    level: 90, promote: 6, cons: index,
    weapon: { id: 100 + index, name: `合成武器${index}`, level: 90, promote: 6, affix: 1 },
    talent: { a: { original: 9, level: 9 }, e: { original: 9, level: 12 }, q: { original: 9, level: 12 } },
    _time: 1700000000,
    artis: { forEach: fn => rows.forEach((row, i) => fn(row, String(i + 1))) },
    fixtureRows: rows,
    calcDmg() { throw Error('P0禁止伤害结算') },
    get attr() { throw Error('P0禁止最终面板反推') }
  }
}
