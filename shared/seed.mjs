/**
 * 初始高频词库（第一版）
 *
 * 选词参考：2021—2025 年国家公务员考试、多省联考及事业单位公开招聘考试
 * 言语理解与表达公开真题中反复出现的成语、实词。释义用现代汉语重新表述；
 * 例句以公开真题的常见语境为参照编写或改写，并非成套题库原文。
 * 每个词条都带来源说明，便于后续继续扩充、校正。
 */

export const SEED_VERSION = 1;

export const SEED_GROUPS = [
  {
    id: 'seed-group-speed',
    name: '成语 · 快慢与成效',
    note: '都和时间、速度、成效有关，重点分清“很快成功”“慢慢积累”“条件成熟”。',
    terms: ['一蹴而就', '一挥而就', '一步登天', '一劳永逸', '立竿见影', '循序渐进', '水到渠成', '瓜熟蒂落', '欲速不达', '日积月累'],
  },
  {
    id: 'seed-group-attitude',
    name: '成语 · 态度与评价',
    note: '考试里最爱张冠李戴的一组，注意词义轻重、感情色彩和适用对象。',
    terms: ['不以为然', '不以为意', '差强人意', '不尽人意', '首当其冲', '当仁不让', '无所不为', '无所不至', '不胫而走', '不翼而飞'],
  },
  {
    id: 'seed-group-official',
    name: '实词 · 公文与日常',
    note: '读音相近、用法不同，常考搭配和词性。做题时先看后面能不能带时间、宾语。',
    terms: ['截至', '截止', '启事', '启示', '必须', '必需', '权利', '权力', '制定', '制订'],
  },
  {
    id: 'seed-group-confuse',
    name: '实词 · 易错搭配',
    note: '这些词一字之差，搭配对象和感情色彩往往不同。',
    terms: ['反应', '反映', '度过', '渡过', '以至', '以致', '侦查', '侦察', '需要', '须要'],
  },
];

const S = '近五年国考、省考及事业编公开真题高频词；例句据公开真题语境改写';
const E = '公务员考试高频词；例句为学习例句（参照公开真题语料编写）';

export const SEED_WORDS = [
  // 易混组一：快慢与成效
  {
    id: 'seed-idiom-01', type: 'idiom', term: '一蹴而就', group: 'seed-group-speed',
    definition: '踏一步就成功。形容事情轻而易举，一下子就能完成。多用于否定句，强调不能急于求成。',
    example: '关键核心技术攻关不可能一蹴而就，必须久久为功。',
    source: S, near: ['一步登天'], far: ['循序渐进', '日积月累'],
  },
  {
    id: 'seed-idiom-02', type: 'idiom', term: '一挥而就', group: 'seed-group-speed',
    definition: '一动笔就写成了。形容写字、作文、绘画等非常敏捷。只用于动笔创作，不用于事情完成。',
    example: '他略作构思，便一挥而就，写下了这幅字。',
    source: S, near: ['一蹴而就'], far: ['江郎才尽', '绞尽脑汁'],
  },
  {
    id: 'seed-idiom-03', type: 'idiom', term: '一步登天', group: 'seed-group-speed',
    definition: '比喻一下子达到极高的境界或程度。多含贬义，常用来提醒不要急于求成。',
    example: '成长没有一步登天的捷径，唯有脚踏实地。',
    source: S, near: ['一蹴而就'], far: ['日积月累', '循序渐进'],
  },
  {
    id: 'seed-idiom-04', type: 'idiom', term: '一劳永逸', group: 'seed-group-speed',
    definition: '辛苦一次，把事情办好，以后就不再费事。常用来否定“一次就能永久解决”的想法。',
    example: '安全管理不可能一劳永逸，必须常抓不懈。',
    source: S, near: ['立竿见影'], far: ['反复无常', '日积月累'],
  },
  {
    id: 'seed-idiom-05', type: 'idiom', term: '立竿见影', group: 'seed-group-speed',
    definition: '把竹竿立在阳光下，马上就能看到影子。比喻收效非常迅速。强调见效快，不强调事情容易。',
    example: '作风建设不能指望立竿见影，要持之以恒。',
    source: S, near: ['一劳永逸'], far: ['循序渐进', '水到渠成'],
  },
  {
    id: 'seed-idiom-06', type: 'idiom', term: '循序渐进', group: 'seed-group-speed',
    definition: '按照一定的次序、步骤逐渐深入或提高。强调过程有先后，不能跳跃。',
    example: '孩子的阅读能力要循序渐进地培养。',
    source: S, near: ['日积月累'], far: ['一蹴而就', '一步登天'],
  },
  {
    id: 'seed-idiom-07', type: 'idiom', term: '水到渠成', group: 'seed-group-speed',
    definition: '水流到的地方自然形成渠道。比喻条件成熟了，事情自然成功。强调条件具备。',
    example: '前期工作做扎实了，项目落地自然水到渠成。',
    source: S, near: ['瓜熟蒂落'], far: ['欲速不达', '一蹴而就'],
  },
  {
    id: 'seed-idiom-08', type: 'idiom', term: '瓜熟蒂落', group: 'seed-group-speed',
    definition: '瓜熟了，瓜蒂自然脱落。比喻条件成熟，事情自然成功。常和水到渠成连用。',
    example: '改革要尊重规律，做到瓜熟蒂落、顺势而为。',
    source: S, near: ['水到渠成'], far: ['拔苗助长', '欲速不达'],
  },
  {
    id: 'seed-idiom-09', type: 'idiom', term: '欲速不达', group: 'seed-group-speed',
    definition: '想求快，反而达不到目的。强调违背规律、一味求快会适得其反。',
    example: '基层治理若急于求成，往往欲速不达。',
    source: S, near: ['拔苗助长'], far: ['水到渠成', '瓜熟蒂落'],
  },
  {
    id: 'seed-idiom-10', type: 'idiom', term: '日积月累', group: 'seed-group-speed',
    definition: '一天天、一月月地不断积累。强调长期坚持，数量由少到多。',
    example: '丰富的词汇来自日积月累的阅读。',
    source: S, near: ['循序渐进'], far: ['一蹴而就', '一挥而就'],
  },

  // 易混组二：态度与评价
  {
    id: 'seed-idiom-11', type: 'idiom', term: '不以为然', group: 'seed-group-attitude',
    definition: '不认为是对的，表示不同意。多含轻视意味。对象通常是某种说法、做法。',
    example: '对他这种说法，我并不以为然。',
    source: S, near: ['不以为意'], far: ['首当其冲', '当仁不让'],
  },
  {
    id: 'seed-idiom-12', type: 'idiom', term: '不以为意', group: 'seed-group-attitude',
    definition: '不把它放在心上，表示不重视、不认真对待。对象通常是可以重视的事情。',
    example: '对反复出现的提醒，他始终不以为意，最终酿成事故。',
    source: S, near: ['不以为然'], far: ['当仁不让', '首当其冲'],
  },
  {
    id: 'seed-idiom-13', type: 'idiom', term: '差强人意', group: 'seed-group-attitude',
    definition: '大体上还能使人满意。“差”是稍微、大致的意思，不是“差劲”，不能理解为很不满意。',
    example: '这份初稿虽然还有不足，但整体质量差强人意。',
    source: S, near: ['不尽人意'], far: ['首当其冲', '无所不为'],
  },
  {
    id: 'seed-idiom-14', type: 'idiom', term: '不尽人意', group: 'seed-group-attitude',
    definition: '不能完全符合人的意愿。常写作“不尽如人意”。表示结果有遗憾，不如期望。',
    example: '由于准备仓促，活动效果不尽人意。',
    source: S, near: ['差强人意'], far: ['当仁不让', '差强人意'],
  },
  {
    id: 'seed-idiom-15', type: 'idiom', term: '首当其冲', group: 'seed-group-attitude',
    definition: '最先受到攻击或遭遇灾难。不是“首先”“第一个做某事”的意思。',
    example: '暴雨来袭，地势低洼的村庄首当其冲。',
    source: S, near: ['当仁不让'], far: ['不以为然', '不以为意'],
  },
  {
    id: 'seed-idiom-16', type: 'idiom', term: '当仁不让', group: 'seed-group-attitude',
    definition: '遇到应该做的事，就积极主动地去做，不推让。含褒义。',
    example: '面对急难险重任务，党员干部当仁不让。',
    source: S, near: ['首当其冲'], far: ['无所不为', '不以为然'],
  },
  {
    id: 'seed-idiom-17', type: 'idiom', term: '无所不为', group: 'seed-group-attitude',
    definition: '没有什么坏事不干。形容什么坏事都做得出来。含贬义。',
    example: '这伙人为了牟利无所不为，最终受到法律制裁。',
    source: S, near: ['无所不至'], far: ['当仁不让', '差强人意'],
  },
  {
    id: 'seed-idiom-18', type: 'idiom', term: '无所不至', group: 'seed-group-attitude',
    definition: '没有达不到的地方；也指凡能做的都做到了。用于坏事时含贬义，也可指照顾得极其周到。',
    example: '他对孩子的照顾无所不至，甚至连书包都替孩子整理。',
    source: S, near: ['无所不为'], far: ['不胫而走', '不翼而飞'],
  },
  {
    id: 'seed-idiom-19', type: 'idiom', term: '不胫而走', group: 'seed-group-attitude',
    definition: '没有腿却能跑。形容消息、传闻等传播得非常快。多用于消息，不用于具体物品丢失。',
    example: '新政策发布后，消息很快不胫而走。',
    source: S, near: ['不翼而飞'], far: ['首当其冲', '当仁不让'],
  },
  {
    id: 'seed-idiom-20', type: 'idiom', term: '不翼而飞', group: 'seed-group-attitude',
    definition: '没有翅膀却飞走了。形容东西突然丢失；也可形容消息传播得很快。',
    example: '他放在桌上的手机转眼间不翼而飞。',
    source: S, near: ['不胫而走'], far: ['无所不至', '差强人意'],
  },

  // 易混组三：公文与日常
  {
    id: 'seed-word-01', type: 'word', term: '截至', group: 'seed-group-official',
    definition: '截止到某个时候。后面必须带时间，表示动作或状态一直延续到那个时间。',
    example: '截至2025年10月底，全国已建成四万余个老年助餐点。',
    source: S, near: ['截止'], far: ['开始', '今后'],
  },
  {
    id: 'seed-word-02', type: 'word', term: '截止', group: 'seed-group-official',
    definition: '到一定期限停止。一般不带宾语；说“截止到某时”时可以带时间，但不能说“截止今天”作谓语带宾语。',
    example: '本次征集活动将于11月30日截止，请抓紧时间提交作品。',
    source: S, near: ['截至'], far: ['延续', '开始'],
  },
  {
    id: 'seed-word-03', type: 'word', term: '启事', group: 'seed-group-official',
    definition: '为了说明某事而登在报刊上或贴在墙壁上的文字。是名词，常见“招聘启事”“寻物启事”。',
    example: '博物馆在门口张贴了志愿者招募启事。',
    source: S, near: ['启示'], far: ['通知', '公告'],
  },
  {
    id: 'seed-word-04', type: 'word', term: '启示', group: 'seed-group-official',
    definition: '启发提示，使有所领悟；也指从某事中得到的启发。既可作动词，也可作名词。',
    example: '这起案例给基层治理带来深刻启示。',
    source: S, near: ['启事'], far: ['蒙蔽', '误导'],
  },
  {
    id: 'seed-word-05', type: 'word', term: '必须', group: 'seed-group-official',
    definition: '副词，一定要。修饰动词或形容词，表示事理上、情理上必要。',
    example: '我们必须把群众的安全放在第一位。',
    source: S, near: ['必需'], far: ['无须', '不必'],
  },
  {
    id: 'seed-word-06', type: 'word', term: '必需', group: 'seed-group-official',
    definition: '一定要有，不可少。多作定语或谓语，常见“必需品”“生存必需”。',
    example: '水和空气是人类生存必需的物质。',
    source: S, near: ['必须'], far: ['多余', '可有可无'],
  },
  {
    id: 'seed-word-07', type: 'word', term: '权利', group: 'seed-group-official',
    definition: '公民或法人依法享有的权力和利益。和“义务”相对，常搭配“享有”“维护”。',
    example: '每一位劳动者都依法享有休息休假的权利。',
    source: S, near: ['权力'], far: ['义务', '责任'],
  },
  {
    id: 'seed-word-08', type: 'word', term: '权力', group: 'seed-group-official',
    definition: '政治上的强制力量；职责范围内的支配力量。常搭配“行使”“监督”“运行”。',
    example: '要把权力关进制度的笼子里。',
    source: S, near: ['权利'], far: ['义务', '责任'],
  },
  {
    id: 'seed-word-09', type: 'word', term: '制定', group: 'seed-group-official',
    definition: '定出法律、规程、计划等。强调创制出最终成果，对象多为法律、制度、规划。',
    example: '有关部门正在制定新的行业标准。',
    source: S, near: ['制订'], far: ['废除', '推翻'],
  },
  {
    id: 'seed-word-10', type: 'word', term: '制订', group: 'seed-group-official',
    definition: '创制拟定。强调拟定、起草的过程，对象多为方案、计划、公约。',
    example: '团队用两周时间制订了详细的实施方案。',
    source: S, near: ['制定'], far: ['搁置', '废止'],
  },

  // 易混组四：易错搭配
  {
    id: 'seed-word-11', type: 'word', term: '反应', group: 'seed-group-confuse',
    definition: '机体受到刺激后产生相应活动；事情引起的意见、态度或行动。常作名词。',
    example: '听到这个消息，大家的反应各不相同。',
    source: S, near: ['反映'], far: ['沉默', '忽视'],
  },
  {
    id: 'seed-word-12', type: 'word', term: '反映', group: 'seed-group-confuse',
    definition: '把情况、意见告诉上级或有关部门；比喻把客观事物的实质表现出来。常作动词。',
    example: '群众通过热线反映小区停车难问题。',
    source: S, near: ['反应'], far: ['隐瞒', '掩盖'],
  },
  {
    id: 'seed-word-13', type: 'word', term: '度过', group: 'seed-group-confuse',
    definition: '经过时间。对象是时间，如“度过假期”“度过童年”。',
    example: '他在乡村度过了难忘的三年。',
    source: S, near: ['渡过'], far: ['开始', '停留'],
  },
  {
    id: 'seed-word-14', type: 'word', term: '渡过', group: 'seed-group-confuse',
    definition: '由此岸到彼岸；比喻从困难、危机中走出来。对象多为江河、难关、危机。',
    example: '全市上下齐心协力，渡过了这次防汛难关。',
    source: S, near: ['度过'], far: ['搁浅', '停留'],
  },
  {
    id: 'seed-word-15', type: 'word', term: '以至', group: 'seed-group-confuse',
    definition: '直到。表示时间、数量、程度的延伸，也可表示上文情况造成的结果，语气中性。',
    example: '从城市到乡村，以至偏远山区，都通了公路。',
    source: S, near: ['以致'], far: ['此外', '反而'],
  },
  {
    id: 'seed-word-16', type: 'word', term: '以致', group: 'seed-group-confuse',
    definition: '表示下文是上述原因造成的结果，多指不好的结果。后面常接不好的事情。',
    example: '他没有认真核对数据，以致报告中出现了多处错误。',
    source: S, near: ['以至'], far: ['反而', '此外'],
  },
  {
    id: 'seed-word-17', type: 'word', term: '侦查', group: 'seed-group-confuse',
    definition: '公安机关、检察机关为了查明案情而进行调查。用于司法、办案语境。',
    example: '公安机关已对该案立案侦查。',
    source: S, near: ['侦察'], far: ['审判', '调解'],
  },
  {
    id: 'seed-word-18', type: 'word', term: '侦察', group: 'seed-group-confuse',
    definition: '为了弄清敌情、地形及其他有关作战情况而进行活动。用于军事语境。',
    example: '侦察兵连夜摸清了前方地形。',
    source: S, near: ['侦查'], far: ['公开', '休整'],
  },
  {
    id: 'seed-word-19', type: 'word', term: '需要', group: 'seed-group-confuse',
    definition: '应该有或必须有；对事物的欲望或要求。使用范围广，可作动词、名词。',
    example: '这个方案还需要进一步论证。',
    source: S, near: ['须要'], far: ['拒绝', '放弃'],
  },
  {
    id: 'seed-word-20', type: 'word', term: '须要', group: 'seed-group-confuse',
    definition: '一定要，必须。多用于肯定句，后面接动词，语气比“需要”更正式、更强。',
    example: '参加考试须要携带本人身份证。',
    source: S, near: ['需要'], far: ['不必', '无须'],
  },

  // 补充高频成语
  {
    id: 'seed-idiom-21', type: 'idiom', term: '莫衷一是',
    definition: '不能得出一致的结论。形容意见分歧，各有各的看法。',
    example: '对于如何保护老街区，与会者莫衷一是。',
    source: E, near: ['无所适从'], far: ['异口同声', '不谋而合'],
  },
  {
    id: 'seed-idiom-22', type: 'idiom', term: '无所适从',
    definition: '不知道依从谁或怎么办才好。强调面对多种说法、做法时没有主张。',
    example: '面对互相矛盾的建议，他一时无所适从。',
    source: E, near: ['莫衷一是'], far: ['游刃有余', '胸有成竹'],
  },
  {
    id: 'seed-idiom-23', type: 'idiom', term: '不可或缺',
    definition: '不能有一点点缺失。表示非常重要，不可缺少。',
    example: '耐心是做好群众工作不可或缺的品质。',
    source: E, near: ['不言而喻'], far: ['无足轻重', '可有可无'],
  },
  {
    id: 'seed-idiom-24', type: 'idiom', term: '不言而喻',
    definition: '不用说就可以明白。形容道理很明显。',
    example: '良好营商环境对企业发展的重要性不言而喻。',
    source: E, near: ['不可或缺'], far: ['匪夷所思', '莫名其妙'],
  },
  {
    id: 'seed-idiom-25', type: 'idiom', term: '相得益彰',
    definition: '互相帮助、互相补充，更能显出各自的好处。含褒义，强调两者配合后效果更好。',
    example: '古城保护与旅游开发可以相得益彰。',
    source: E, near: ['相辅相成'], far: ['两败俱伤', '势不两立'],
  },
  {
    id: 'seed-idiom-26', type: 'idiom', term: '相辅相成',
    definition: '互相补充，互相配合。强调两者缺一不可、共同发挥作用。',
    example: '制度建设与道德教育相辅相成。',
    source: E, near: ['相得益彰'], far: ['势不两立', '两败俱伤'],
  },
  {
    id: 'seed-idiom-27', type: 'idiom', term: '耳濡目染',
    definition: '耳朵经常听到，眼睛经常看到，不知不觉受到影响。强调长期处在某种环境中。',
    example: '从小耳濡目染，他对传统戏曲产生了浓厚兴趣。',
    source: E, near: ['潜移默化'], far: ['置之度外', '无动于衷'],
  },
  {
    id: 'seed-idiom-28', type: 'idiom', term: '潜移默化',
    definition: '人的思想或性格受环境、别人的影响，不知不觉中起了变化。强调影响是渐进的。',
    example: '良好的家风会在潜移默化中影响孩子。',
    source: E, near: ['耳濡目染'], far: ['一成不变', '无动于衷'],
  },
  {
    id: 'seed-idiom-29', type: 'idiom', term: '浮光掠影',
    definition: '像水面的光和掠过的影子，一晃就消逝。比喻观察不细致、印象不深。',
    example: '调研不能浮光掠影，要沉到一线摸实情。',
    source: E, near: ['走马观花'], far: ['洞若观火', '明察秋毫'],
  },
  {
    id: 'seed-idiom-30', type: 'idiom', term: '走马观花',
    definition: '骑在马上看花。比喻粗略地观察事物，不深入。',
    example: '参观学习不能走马观花，要带着问题看。',
    source: E, near: ['浮光掠影'], far: ['精益求精', '入木三分'],
  },
  {
    id: 'seed-idiom-31', type: 'idiom', term: '缘木求鱼',
    definition: '爬到树上去找鱼。比喻方向、方法不对，一定达不到目的。',
    example: '脱离实际谈发展，无异于缘木求鱼。',
    source: E, near: ['南辕北辙'], far: ['因地制宜', '对症下药'],
  },
  {
    id: 'seed-idiom-32', type: 'idiom', term: '南辕北辙',
    definition: '想往南却往北走。比喻行动和目的相反。强调行动与目标背道而驰。',
    example: '如果只追求速度而忽视质量，结果只会南辕北辙。',
    source: E, near: ['缘木求鱼'], far: ['殊途同归', '因地制宜'],
  },

  // 补充高频实词
  {
    id: 'seed-word-21', type: 'word', term: '遏制',
    definition: '制止，使不能继续发展。对象多是不好的事物、势头，强调控制住。',
    example: '坚决遏制耕地“非农化”势头。',
    source: E, near: ['遏止'], far: ['放任', '纵容'],
  },
  {
    id: 'seed-word-22', type: 'word', term: '遏止',
    definition: '用力阻止，使停止。强调使某种活动停下来，语气比“遏制”更重。',
    example: '历史的车轮滚滚向前，不可遏止。',
    source: E, near: ['遏制'], far: ['纵容', '放任'],
  },
  {
    id: 'seed-word-23', type: 'word', term: '界限',
    definition: '不同事物的分界；限度。多用于抽象事物，如“公私界限”“认识界限”。',
    example: '在工作与生活之间，他划出了一条清晰的界限。',
    source: E, near: ['界线'], far: ['融合', '交汇'],
  },
  {
    id: 'seed-word-24', type: 'word', term: '界线',
    definition: '两个地区之间的分界线；也指不同事物的分界。多用于具体地理边界。',
    example: '两省以这条河为界线。',
    source: E, near: ['界限'], far: ['交汇', '融合'],
  },
  {
    id: 'seed-word-25', type: 'word', term: '启用',
    definition: '开始使用。对象多为设施、设备、系统等，不能用于人。',
    example: '新图书馆将于下月正式启用。',
    source: E, near: ['起用'], far: ['停用', '关闭'],
  },
  {
    id: 'seed-word-26', type: 'word', term: '起用',
    definition: '重新任用已退职或免职的官员；也指提拔使用。对象是人。',
    example: '公司决定起用一批年轻干部。',
    source: E, near: ['启用'], far: ['弃用', '冷落'],
  },
  {
    id: 'seed-word-27', type: 'word', term: '逐步',
    definition: '一步一步地。强调有计划、有步骤地推进，常用于改革、推进等工作。',
    example: '改革将逐步推开，不搞一刀切。',
    source: E, near: ['逐渐'], far: ['骤然', '立刻'],
  },
  {
    id: 'seed-word-28', type: 'word', term: '逐渐',
    definition: '渐渐。强调程度或数量缓慢、自然地变化。',
    example: '随着天气转暖，河面的冰逐渐融化。',
    source: E, near: ['逐步'], far: ['猛然', '突然'],
  },
];

export function createSeedState(nowIso = new Date().toISOString()) {
  const words = {};
  const groups = {};
  for (const item of SEED_WORDS) {
    const { group, ...rest } = item;
    words[item.id] = {
      ...rest,
      near: [...(item.near || [])],
      far: [...(item.far || [])],
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null,
    };
  }
  for (const group of SEED_GROUPS) {
    groups[group.id] = {
      id: group.id,
      name: group.name,
      note: group.note,
      wordIds: SEED_WORDS.filter((w) => w.group === group.id).map((w) => w.id),
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null,
    };
    if (!groups[group.id].wordIds.length) {
      throw new Error(`初始易混组为空：${group.id}`);
    }
  }
  return {
    version: 1,
    seedVersion: SEED_VERSION,
    words,
    groups,
    progress: {},
    mistakes: {},
    checkins: {},
    settings: {
      dailyNewLimit: 20,
      reviewMode: 'clear',
      reviewDailyLimit: 30,
      practiceMode: 'reveal',
      scope: 'all',
      updatedAt: nowIso,
    },
  };
}
