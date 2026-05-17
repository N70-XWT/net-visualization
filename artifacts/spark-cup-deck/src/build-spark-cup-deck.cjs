const fs = require('fs');
const path = require('path');
const PptxGenJS = require('pptxgenjs');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..', '..', '..');
const workDir = path.join(root, 'artifacts', 'spark-cup-deck');
const assetDir = path.join(workDir, 'assets');
const outDir = path.join(workDir, 'output');
const previewDir = path.join(workDir, 'previews');

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(previewDir, { recursive: true });

const heroPath = path.join(assetDir, 'network-ops-hero.png');
const screenshotPath = path.join(assetDir, 'product-screenshot.png');
const outputPptx = path.join(outDir, 'spark-cup-netviz-roadshow.pptx');

const slideW = 13.333;
const slideH = 7.5;
const pxW = 1920;
const pxH = 1080;

const C = {
  ink: '08111F',
  ink2: '0E1B2E',
  panel: '12243A',
  panel2: '18304C',
  text: 'F3F8FF',
  muted: 'A8BCD4',
  dim: '6F859E',
  cyan: '31D7FF',
  cyan2: '7AE7FF',
  green: '27E8A7',
  amber: 'FFD166',
  red: 'FF5A6A',
  white: 'FFFFFF',
};

const font = 'Microsoft YaHei';
const titleFont = 'Microsoft YaHei UI';

const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'Codex';
pptx.company = 'Net Visualization Project';
pptx.subject = '中国国际大学生创新创业大赛路演稿';
pptx.title = '物联慧眼：三层异构网络态势感知与可视化平台';
pptx.lang = 'zh-CN';
pptx.theme = {
  headFontFace: titleFont,
  bodyFontFace: font,
  lang: 'zh-CN',
};
pptx.defineLayout({ name: 'CUSTOM_WIDE', width: slideW, height: slideH });
pptx.layout = 'CUSTOM_WIDE';

function addText(slide, text, x, y, w, h, opts = {}) {
  slide.addText(text, {
    x,
    y,
    w,
    h,
    fontFace: opts.fontFace || font,
    fontSize: opts.size || 18,
    color: opts.color || C.text,
    bold: !!opts.bold,
    italic: !!opts.italic,
    breakLine: false,
    fit: 'shrink',
    margin: opts.margin || 0.02,
    valign: opts.valign || 'top',
    align: opts.align || 'left',
    paraSpaceAfterPt: 0,
    breakLine: false,
  });
}

function rect(slide, x, y, w, h, fill, line = fill, transparency = 0, radius = false) {
  slide.addShape(radius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
    x,
    y,
    w,
    h,
    fill: { color: fill, transparency },
    line: { color: line, transparency: line === fill ? 100 : 0, width: 1 },
    radius: radius ? 0.12 : undefined,
  });
}

function line(slide, x1, y1, x2, y2, color = C.cyan, width = 1.5, dash = 'solid') {
  slide.addShape(pptx.ShapeType.line, {
    x: x1,
    y: y1,
    w: x2 - x1,
    h: y2 - y1,
    line: { color, width, dash },
  });
}

function addPill(slide, text, x, y, w, color = C.cyan, fill = C.ink2) {
  rect(slide, x, y, w, 0.34, fill, color, 8, true);
  addText(slide, text, x + 0.08, y + 0.075, w - 0.16, 0.17, {
    size: 8.8,
    color,
    bold: true,
    align: 'center',
  });
}

function addFooter(slide, index) {
  addText(slide, '物联慧眼 | 星火杯版本路演稿', 0.58, 7.08, 4.2, 0.18, {
    size: 7.8,
    color: C.dim,
  });
  addText(slide, String(index).padStart(2, '0'), 12.25, 7.02, 0.52, 0.24, {
    size: 10,
    color: C.dim,
    bold: true,
    align: 'right',
  });
  line(slide, 0.58, 6.94, 12.75, 6.94, C.panel2, 0.6);
}

function addTitle(slide, kicker, title, subtitle, index) {
  addPill(slide, kicker, 0.58, 0.48, Math.min(2.9, 0.68 + kicker.length * 0.12), C.green, C.ink2);
  addText(slide, title, 0.58, 0.9, 8.9, 0.75, {
    size: 28,
    bold: true,
    color: C.text,
    fontFace: titleFont,
  });
  if (subtitle) {
    addText(slide, subtitle, 0.6, 1.62, 8.7, 0.4, {
      size: 11.5,
      color: C.muted,
    });
  }
  addFooter(slide, index);
}

function addMetric(slide, label, value, x, y, color = C.cyan) {
  addText(slide, value, x, y, 1.72, 0.38, { size: 21, bold: true, color });
  addText(slide, label, x, y + 0.44, 1.82, 0.24, { size: 8.5, color: C.muted });
}

function addBullets(slide, items, x, y, w, opts = {}) {
  items.forEach((item, index) => {
    const yy = y + index * (opts.gap || 0.58);
    rect(slide, x, yy + 0.08, 0.08, 0.08, opts.color || C.green, opts.color || C.green, 0, true);
    addText(slide, item, x + 0.22, yy, w - 0.22, opts.lineH || 0.38, {
      size: opts.size || 13.2,
      color: opts.textColor || C.text,
      bold: !!opts.bold,
    });
  });
}

function addBand(slide, x, y, w, h, title, body, color = C.cyan) {
  line(slide, x, y, x + w, y, color, 2.2);
  addText(slide, title, x, y + 0.18, w, 0.28, { size: 12.5, bold: true, color: C.text });
  addText(slide, body, x, y + 0.58, w, h - 0.55, { size: 10.4, color: C.muted });
}

function safePngData(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase() || 'png';
  const data = fs.readFileSync(filePath).toString('base64');
  return `data:image/${ext};base64,${data}`;
}

function svgText(text, x, y, size, color = '#fff', weight = 400, width = 1000) {
  const escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<text x="${x}" y="${y}" fill="${color}" font-family="Microsoft YaHei, Arial" font-size="${size}" font-weight="${weight}">${escaped}</text>`;
}

function svgRect(x, y, w, h, fill, stroke = 'none', rx = 0, opacity = 1) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" opacity="${opacity}"/>`;
}

function previewBase(title, subtitle = '', dark = true) {
  const bg = dark ? `#${C.ink}` : '#F7FBFF';
  const fg = dark ? `#${C.text}` : '#0B1220';
  const muted = dark ? `#${C.muted}` : '#52657B';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pxW}" height="${pxH}" viewBox="0 0 ${pxW} ${pxH}">`,
    svgRect(0, 0, pxW, pxH, bg),
    svgText(title, 84, 132, 54, fg, 700),
    subtitle ? svgText(subtitle, 88, 190, 26, muted, 400) : '',
  ];
}

async function writePreview(index, parts) {
  const svg = `${parts.join('\n')}\n</svg>`;
  const out = path.join(previewDir, `slide-${String(index).padStart(2, '0')}.png`);
  await sharp(Buffer.from(svg)).png().toFile(out);
  return out;
}

const previewJobs = [];

function slideCover() {
  const slide = pptx.addSlide();
  slide.background = { color: C.ink };
  slide.addImage({ path: heroPath, x: 0, y: 0, w: slideW, h: slideH });
  rect(slide, 0, 0, 6.7, slideH, C.ink, C.ink, 7);
  rect(slide, 0, 0, slideW, slideH, C.ink, C.ink, 16);
  addText(slide, '物联慧眼', 0.62, 1.0, 4.5, 0.7, { size: 38, bold: true, fontFace: titleFont });
  addText(slide, '三层异构网络态势感知与可视化平台', 0.66, 1.86, 5.45, 0.55, {
    size: 20,
    bold: true,
    color: C.cyan2,
  });
  line(slide, 0.67, 2.62, 2.3, 2.62, C.green, 3);
  addText(slide, '面向应急通信、校园/园区专网、物联网运维的实时网络态势操作系统', 0.68, 2.82, 5.35, 0.72, {
    size: 14,
    color: C.muted,
  });
  addPill(slide, '星火杯版本 | Git ee715bc', 0.68, 3.75, 2.45, C.amber, C.ink2);
  addPill(slide, '中国国际大学生创新创业大赛路演稿', 3.35, 3.75, 3.2, C.cyan, C.ink2);
  addText(slide, '参赛赛道/组别：待填写    推荐院系：待填写', 0.68, 6.34, 5.6, 0.24, { size: 9.8, color: C.muted });
  addText(slide, '负责人：待填写    手机：待填写    QQ：待填写', 0.68, 6.7, 5.6, 0.24, { size: 9.8, color: C.muted });

  previewJobs.push(writePreview(1, [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pxW}" height="${pxH}" viewBox="0 0 ${pxW} ${pxH}">`,
    `<image href="${safePngData(heroPath)}" x="0" y="0" width="${pxW}" height="${pxH}" preserveAspectRatio="xMidYMid slice"/>`,
    svgRect(0, 0, 965, 1080, `#${C.ink}`, 'none', 0, 0.85),
    svgText('物联慧眼', 95, 235, 88, `#${C.text}`, 800),
    svgText('三层异构网络态势感知与可视化平台', 98, 330, 38, `#${C.cyan2}`, 700),
    svgRect(98, 380, 250, 7, `#${C.green}`),
    svgText('面向应急通信、校园/园区专网、物联网运维的实时网络态势操作系统', 100, 455, 26, `#${C.muted}`, 400),
    svgText('星火杯版本 | Git ee715bc', 100, 595, 22, `#${C.amber}`, 700),
  ]));
}

function slideProblem() {
  const slide = pptx.addSlide();
  slide.background = { color: C.ink };
  addTitle(slide, '01 真实痛点', '异构网络越复杂，态势盲区越先出现', '多层通信网络已经从“单网监控”走向“跨层协同”，但运维工具仍停留在割裂视图。', 2);
  addText(slide, '客户现场常见三类断点', 0.72, 2.28, 3.6, 0.36, { size: 15, bold: true, color: C.cyan2 });
  addBullets(slide, [
    '骨干、Ad hoc、接入与终端状态分散，故障定位依赖人工拼图',
    '链路质量、告警、拓扑变化不能同步，事件可见性滞后',
    '事后复盘缺少历史快照，演练和责任分析难以闭环',
  ], 0.78, 2.86, 5.15, { gap: 0.78, size: 14 });
  rect(slide, 6.65, 2.05, 5.85, 3.9, C.panel, C.panel2, 0, true);
  addText(slide, '目标用户', 7.0, 2.45, 1.8, 0.28, { size: 14, bold: true, color: C.green });
  addBand(slide, 7.0, 2.94, 2.35, 1.0, '网络运维人员', '快速发现故障、定位影响范围', C.cyan);
  addBand(slide, 9.6, 2.94, 2.35, 1.0, '安全分析人员', '追踪异常传播和风险链路', C.red);
  addBand(slide, 7.0, 4.25, 2.35, 1.0, '网络规划人员', '评估容量与覆盖薄弱点', C.amber);
  addBand(slide, 9.6, 4.25, 2.35, 1.0, '系统管理员', '维护拓扑、接口和事件数据', C.green);
  addText(slide, '评委听点：不是“做一张地图”，而是把割裂网络数据变成可操作、可复盘、可交付的态势平台。', 0.78, 6.2, 10.9, 0.35, { size: 12.3, color: C.amber, bold: true });

  previewJobs.push(writePreview(2, [
    ...previewBase('异构网络越复杂，态势盲区越先出现', '三层通信网络的运维工具仍停留在割裂视图'),
    svgRect(98, 330, 740, 360, `#${C.panel}`, `#${C.panel2}`, 22, 0.95),
    svgText('分散监控 / 滞后告警 / 缺少复盘', 145, 410, 34, `#${C.cyan2}`, 700),
    svgText('客户价值：把网络数据变成可操作、可追踪、可复盘的态势平台', 145, 500, 28, `#${C.text}`, 500),
    svgRect(970, 330, 700, 360, `#${C.panel}`, `#${C.panel2}`, 22, 0.95),
    svgText('运维人员  安全分析  网络规划  系统管理', 1020, 470, 34, `#${C.green}`, 700),
  ]));
}

function slideProduct() {
  const slide = pptx.addSlide();
  slide.background = { color: C.ink };
  addTitle(slide, '02 产品定位', '一个平台完成建模、监控、分析、回放', '从节点和链路数据进入，到态势判断和历史复盘输出，形成完整闭环。', 3);
  const x0 = 0.85;
  const y0 = 2.35;
  const steps = [
    ['统一建模', 'Node / Link / CrossLayerRelation / Event / Snapshot'],
    ['实时更新', 'REST + WebSocket + Python 快照适配'],
    ['态势可视', '2D / 3D 地图、过滤搜索、详情联动'],
    ['分析决策', '连通性、最短路径、告警关联、历史回放'],
  ];
  steps.forEach(([title, body], i) => {
    const x = x0 + i * 3.05;
    rect(slide, x, y0 + (i % 2) * 0.35, 2.38, 2.1, i === 0 ? C.panel2 : C.panel, i === 0 ? C.cyan : C.panel2, 0, true);
    addText(slide, `0${i + 1}`, x + 0.18, y0 + 0.22 + (i % 2) * 0.35, 0.55, 0.3, { size: 13, color: i === 0 ? C.green : C.cyan, bold: true });
    addText(slide, title, x + 0.18, y0 + 0.62 + (i % 2) * 0.35, 1.8, 0.32, { size: 16, bold: true });
    addText(slide, body, x + 0.18, y0 + 1.08 + (i % 2) * 0.35, 1.96, 0.66, { size: 9.4, color: C.muted });
    if (i < 3) line(slide, x + 2.48, y0 + 1.05 + (i % 2) * 0.35, x + 2.92, y0 + 1.05 + ((i + 1) % 2) * 0.35, C.green, 1.4);
  });
  addMetric(slide, '当前演示节点', '19', 1.0, 5.65, C.green);
  addMetric(slide, '当前演示链路', '23', 2.9, 5.65, C.cyan);
  addMetric(slide, '网络健康度', '69%', 4.8, 5.65, C.amber);
  addMetric(slide, '平均时延', '55.8ms', 6.7, 5.65, C.cyan2);
  addMetric(slide, '平均丢包', '4.29%', 8.78, 5.65, C.red);

  previewJobs.push(writePreview(3, [
    ...previewBase('一个平台完成建模、监控、分析、回放', '从数据进入到态势输出，形成演示闭环'),
    svgText('统一建模  →  实时更新  →  态势可视  →  分析决策', 155, 475, 42, `#${C.green}`, 700),
    svgText('19 节点 / 23 链路 / 健康度 69% / 平均时延 55.8ms', 155, 650, 34, `#${C.text}`, 700),
  ]));
}

function slideArchitecture() {
  const slide = pptx.addSlide();
  slide.background = { color: C.ink };
  addTitle(slide, '03 技术架构', '前端负责态势表达，后端负责模型与事件组织', '保持 React + Leaflet / Node.js / REST + WebSocket 的推荐技术栈，利于答辩演示和后续扩展。', 4);
  const cols = [
    ['采集与数据层', ['Python 场景生成器', 'snapshot / metrics / event 文件', '动态节点和链路模拟']],
    ['服务与模型层', ['Node.js REST 服务', '统一拓扑仓储', '告警推导与历史帧缓存']],
    ['接口与通信层', ['GET /api/topology', 'GET /api/situation/current', 'POST /api/topology/events']],
    ['可视分析层', ['React + Leaflet 地图', '2D / 3D 模式切换', '过滤、搜索、回放、路径分析']],
  ];
  cols.forEach(([title, items], i) => {
    const x = 0.62 + i * 3.15;
    rect(slide, x, 2.28, 2.55, 3.95, i % 2 ? C.panel : C.panel2, C.panel2, 0, true);
    addText(slide, title, x + 0.2, 2.62, 2.1, 0.3, { size: 14.5, bold: true, color: [C.green, C.cyan, C.amber, C.cyan2][i] });
    addBullets(slide, items, x + 0.22, 3.18, 2.16, { gap: 0.56, size: 9.8, color: [C.green, C.cyan, C.amber, C.cyan2][i] });
  });
  addText(slide, '版本化消息信封：type / version / timestamp / trace_id / payload，便于实时更新和回放一致性。', 1.0, 6.45, 10.7, 0.27, { size: 11.5, color: C.muted, align: 'center' });

  previewJobs.push(writePreview(4, [
    ...previewBase('前端负责态势表达，后端负责模型与事件组织', 'React + Leaflet / Node.js / REST + WebSocket'),
    svgRect(120, 335, 360, 440, `#${C.panel2}`, `#${C.green}`, 22),
    svgRect(560, 335, 360, 440, `#${C.panel}`, `#${C.cyan}`, 22),
    svgRect(1000, 335, 360, 440, `#${C.panel}`, `#${C.amber}`, 22),
    svgRect(1440, 335, 360, 440, `#${C.panel2}`, `#${C.cyan2}`, 22),
    svgText('采集数据', 200, 470, 34, `#${C.green}`, 700),
    svgText('模型服务', 640, 470, 34, `#${C.cyan}`, 700),
    svgText('接口通信', 1080, 470, 34, `#${C.amber}`, 700),
    svgText('可视分析', 1520, 470, 34, `#${C.cyan2}`, 700),
  ]));
}

function slidePrototype() {
  const slide = pptx.addSlide();
  slide.background = { color: C.ink };
  addTitle(slide, '04 原型证据', '星火杯版本已经具备可演示闭环', '截图来自当前构建产物：动态拓扑、实时指标、回放、告警与分析入口集中在一个操作台。', 5);
  rect(slide, 0.66, 2.12, 8.55, 4.55, C.panel, C.panel2, 0, true);
  slide.addImage({ path: screenshotPath, x: 0.78, y: 2.24, w: 8.3, h: 4.67 });
  rect(slide, 9.52, 2.2, 2.92, 3.7, C.panel, C.panel2, 0, true);
  addText(slide, '当前能力清单', 9.84, 2.55, 2.2, 0.3, { size: 15, bold: true, color: C.green });
  addBullets(slide, [
    '节点/链路/跨层关系统一展示',
    '实时轮询与事件列表',
    '历史帧回放与播放状态',
    '连通性与最短路径分析',
    '动态节点增删命令通道',
  ], 9.86, 3.08, 2.25, { gap: 0.48, size: 9.3 });
  addText(slide, '构建验证：npm run build 已通过', 9.84, 5.52, 2.2, 0.22, { size: 8.8, color: C.amber, bold: true });

  previewJobs.push(writePreview(5, [
    ...previewBase('星火杯版本已经具备可演示闭环', '当前构建截图：动态拓扑、实时指标、回放、告警与分析入口'),
    `<image href="${safePngData(screenshotPath)}" x="120" y="290" width="1280" height="720" preserveAspectRatio="xMidYMid slice"/>`,
    svgText('产品截图', 1440, 360, 38, `#${C.green}`, 700),
    svgText('19 节点 / 23 链路 / 历史回放 / 路径分析', 1440, 440, 28, `#${C.text}`, 500),
  ]));
}

function slideInnovation() {
  const slide = pptx.addSlide();
  slide.background = { color: C.ink };
  addTitle(slide, '05 核心创新', '把“网络图”升级为“可计算的态势模型”', '创新点不止在可视化界面，而在跨层关系、事件驱动和可复盘数据组织。', 6);
  const items = [
    ['跨层关系一等建模', 'CrossLayerRelation 不再只是 UI 连线，而是可查询、可推导、可分析的数据实体。'],
    ['事件驱动态势快照', '拓扑变化、指标变化、告警变化进入统一时间轴，为回放和复盘提供数据基础。'],
    ['面向决策的图分析', '连通性分析与时延加权最短路径，把“哪里坏了”推进到“影响什么”。'],
    ['可演练动态仿真', 'Python 生成器和命令队列支持动态节点、链路劣化、节点上下线等场景验证。'],
  ];
  items.forEach(([title, body], i) => {
    const x = 0.82 + (i % 2) * 6.05;
    const y = 2.28 + Math.floor(i / 2) * 1.88;
    line(slide, x, y, x + 4.85, y, [C.green, C.cyan, C.amber, C.red][i], 2.4);
    addText(slide, title, x, y + 0.22, 4.8, 0.34, { size: 16, bold: true, color: C.text });
    addText(slide, body, x, y + 0.72, 4.85, 0.62, { size: 11.2, color: C.muted });
  });
  addText(slide, '对应大赛评审：问题导向、创新成效、专业知识与商业价值转化。', 0.82, 6.42, 8.3, 0.25, { size: 11.5, color: C.amber, bold: true });

  previewJobs.push(writePreview(6, [
    ...previewBase('把“网络图”升级为“可计算的态势模型”', '跨层关系、事件驱动、图分析、动态仿真'),
    svgText('CrossLayerRelation', 135, 430, 40, `#${C.green}`, 700),
    svgText('Event → Snapshot → Replay', 865, 430, 40, `#${C.cyan}`, 700),
    svgText('Connectivity / Shortest Path', 135, 650, 40, `#${C.amber}`, 700),
    svgText('Python Scenario Simulation', 865, 650, 40, `#${C.red}`, 700),
  ]));
}

function slideMarket() {
  const slide = pptx.addSlide();
  slide.background = { color: C.ink };
  addTitle(slide, '06 市场与客户', '先从高价值专网场景切入，再扩展到行业化运维平台', '产品适合“网络结构复杂、链路环境变化快、需要演练复盘”的组织。', 7);
  const sectors = [
    ['应急通信与演练', '临时组网、无人机中继、卫星回传，要求快速态势感知与复盘。', C.red],
    ['高校/园区专网', '校园 IoT、安防、边缘节点、实验平台，适合试点和示范。', C.green],
    ['能源/交通/工业物联', '远程站点、无线回传、链路质量波动，需要集中运维。', C.amber],
    ['运营商边缘网络', '多接入边缘、专线与无线协同，适合做模块化集成。', C.cyan],
  ];
  sectors.forEach(([title, body, color], i) => {
    const x = 0.78 + i * 3.05;
    rect(slide, x, 2.52, 2.45, 3.12, C.panel, C.panel2, 0, true);
    addText(slide, title, x + 0.18, 2.92, 2.08, 0.42, { size: 14, bold: true, color });
    addText(slide, body, x + 0.18, 3.52, 2.02, 0.9, { size: 10.2, color: C.muted });
    addText(slide, `切入级别 ${i + 1}`, x + 0.18, 5.12, 1.4, 0.2, { size: 8.8, color: C.dim });
  });
  addText(slide, '商业判断：先卖“可部署原型 + 定制场景包”，再沉淀为可复用模块和年度运维服务。', 0.82, 6.24, 10.9, 0.28, { size: 12, color: C.amber, bold: true });

  previewJobs.push(writePreview(7, [
    ...previewBase('先从高价值专网场景切入，再扩展到行业化运维平台', '应急通信 / 园区专网 / 工业物联 / 运营商边缘网络'),
    svgText('应急通信', 160, 470, 42, `#${C.red}`, 700),
    svgText('高校园区', 560, 470, 42, `#${C.green}`, 700),
    svgText('工业物联', 960, 470, 42, `#${C.amber}`, 700),
    svgText('边缘网络', 1360, 470, 42, `#${C.cyan}`, 700),
  ]));
}

function slideBusiness() {
  const slide = pptx.addSlide();
  slide.background = { color: C.ink };
  addTitle(slide, '07 商业模式', '原型交付、模块授权、运维服务三条收入线', '创意阶段以项目制验证客户价值，成熟后转为平台化授权与行业方案复制。', 8);
  addBand(slide, 0.88, 2.3, 3.3, 1.1, '项目制交付', '面向学校/园区/实验室提供私有化部署、定制拓扑场景和演示大屏。', C.green);
  addBand(slide, 4.9, 2.3, 3.3, 1.1, '模块化授权', '按拓扑建模、告警联动、历史回放、分析算法模块进行授权。', C.cyan);
  addBand(slide, 8.9, 2.3, 3.3, 1.1, '运维订阅服务', '年度维护、数据适配、演练脚本、二次开发支持和培训服务。', C.amber);
  rect(slide, 1.05, 4.48, 10.95, 1.35, C.panel, C.panel2, 0, true);
  addText(slide, '收费模型建议（可在赛前按实际团队资源调整）', 1.35, 4.78, 5.4, 0.25, { size: 12.5, bold: true, color: C.cyan2 });
  addText(slide, 'PoC 试点：3-8 万元/项目    私有化部署：10-30 万元/套    年度服务：软件合同额 15%-25%', 1.35, 5.24, 9.8, 0.25, { size: 12, color: C.text, bold: true });
  addText(slide, '重点包装：项目符合“科技成果转化 + 商业/社会价值”的评分语言，同时保留学生团队可执行性。', 1.35, 6.12, 9.1, 0.28, { size: 11.5, color: C.muted });

  previewJobs.push(writePreview(8, [
    ...previewBase('原型交付、模块授权、运维服务三条收入线', '创意阶段先验证，成熟后平台化复制'),
    svgText('PoC 试点', 180, 470, 42, `#${C.green}`, 700),
    svgText('私有化部署', 760, 470, 42, `#${C.cyan}`, 700),
    svgText('年度服务', 1320, 470, 42, `#${C.amber}`, 700),
    svgText('3-8 万 / 10-30 万 / 15%-25%', 400, 690, 44, `#${C.text}`, 800),
  ]));
}

function slideCompetition() {
  const slide = pptx.addSlide();
  slide.background = { color: C.ink };
  addTitle(slide, '08 竞品与差异', '不是替代所有网管，而是补齐“跨层态势 + 回放演练”空白', '与传统网管、GIS 可视化、开源地图和 IoT 平台相比，本项目更适合教学科研与专网演练场景。', 9);
  const headers = ['对比维度', '传统网管', 'GIS/地图系统', 'IoT 平台', '物联慧眼'];
  const rows = [
    ['跨层建模', '弱', '弱', '中', '强'],
    ['实时事件', '中', '弱', '中', '强'],
    ['历史回放', '弱', '弱', '中', '强'],
    ['可二次开发', '中', '强', '中', '强'],
    ['学生团队可演示', '弱', '中', '中', '强'],
  ];
  const x = 0.72;
  const y = 2.28;
  const colW = [2.2, 2.15, 2.15, 2.15, 2.25];
  let cx = x;
  headers.forEach((h, i) => {
    rect(slide, cx, y, colW[i], 0.46, i === 4 ? C.green : C.panel2, i === 4 ? C.green : C.panel2, 0, false);
    addText(slide, h, cx + 0.08, y + 0.12, colW[i] - 0.16, 0.16, { size: 9.8, bold: true, color: i === 4 ? C.ink : C.text, align: 'center' });
    cx += colW[i];
  });
  rows.forEach((row, r) => {
    cx = x;
    row.forEach((cell, c) => {
      rect(slide, cx, y + 0.52 + r * 0.62, colW[c], 0.5, c === 4 ? C.panel2 : C.panel, C.ink2, 0, false);
      addText(slide, cell, cx + 0.08, y + 0.67 + r * 0.62, colW[c] - 0.16, 0.16, {
        size: 9.5,
        bold: c === 0 || c === 4,
        color: c === 4 ? C.green : c === 0 ? C.cyan2 : C.muted,
        align: 'center',
      });
      cx += colW[c];
    });
  });
  addText(slide, '差异化结论：围绕异构网络原型验证和教学科研答辩，本项目的轻量、可解释、可扩展比重型商业网管更有优势。', 0.82, 6.25, 10.7, 0.28, { size: 11.5, color: C.amber, bold: true });

  previewJobs.push(writePreview(9, [
    ...previewBase('不是替代所有网管，而是补齐“跨层态势 + 回放演练”空白', '竞品对比凸显演示场景与二次开发优势'),
    svgRect(110, 315, 1700, 530, `#${C.panel}`, `#${C.panel2}`, 20),
    svgText('传统网管     GIS/地图系统     IoT 平台     物联慧眼', 230, 500, 42, `#${C.text}`, 700),
    svgText('跨层建模 / 实时事件 / 历史回放 / 可二开 / 可演示', 280, 650, 34, `#${C.green}`, 700),
  ]));
}

function slideGoToMarket() {
  const slide = pptx.addSlide();
  slide.background = { color: C.ink };
  addTitle(slide, '09 落地路径', '用三类试点把原型跑成可信产品', '比赛阶段重在证明“能跑、能讲、能卖、能迭代”。', 10);
  const milestones = [
    ['M1 赛事版', '完成统一模型、动态拓扑、历史回放、REST API 展示'],
    ['M2 校园试点', '接入实验室/校园 IoT 数据，形成真实运行样例'],
    ['M3 行业演练', '面向应急通信或园区专网开发演练脚本包'],
    ['M4 商业封装', '形成部署文档、API 合同、报价单和客户案例'],
  ];
  milestones.forEach(([title, body], i) => {
    const y = 2.28 + i * 0.9;
    addText(slide, title, 0.9, y, 1.55, 0.28, { size: 12.5, bold: true, color: [C.green, C.cyan, C.amber, C.red][i] });
    line(slide, 2.58, y + 0.15, 11.75, y + 0.15, [C.green, C.cyan, C.amber, C.red][i], 1.4);
    addText(slide, body, 2.78, y - 0.04, 7.9, 0.3, { size: 11.3, color: C.text });
  });
  rect(slide, 0.9, 6.0, 10.9, 0.66, C.panel, C.panel2, 0, true);
  addText(slide, '近期可补材料：应用单位试用意见、软著/论文/专利证明、团队分工、指导教师与实验平台照片。', 1.18, 6.22, 9.9, 0.22, { size: 11.2, color: C.amber, bold: true });

  previewJobs.push(writePreview(10, [
    ...previewBase('用三类试点把原型跑成可信产品', '赛事版 → 校园试点 → 行业演练 → 商业封装'),
    svgText('M1 赛事版', 150, 420, 34, `#${C.green}`, 700),
    svgText('M2 校园试点', 150, 540, 34, `#${C.cyan}`, 700),
    svgText('M3 行业演练', 150, 660, 34, `#${C.amber}`, 700),
    svgText('M4 商业封装', 150, 780, 34, `#${C.red}`, 700),
  ]));
}

function slideFinance() {
  const slide = pptx.addSlide();
  slide.background = { color: C.ink };
  addTitle(slide, '10 三年预测', '从试点收入到模块化复制，形成轻资产增长曲线', '以下为路演测算口径，赛前可按真实团队资源、试点单位和报价进一步校准。', 11);
  const chartData = [
    { name: '项目制收入', labels: ['2026', '2027', '2028'], values: [18, 56, 96] },
    { name: '授权与服务收入', labels: ['2026', '2027', '2028'], values: [6, 42, 128] },
  ];
  slide.addChart(pptx.ChartType.bar, chartData, {
    x: 0.9,
    y: 2.28,
    w: 6.4,
    h: 3.6,
    catAxisLabelFontFace: font,
    catAxisLabelFontSize: 9,
    valAxisLabelFontFace: font,
    valAxisLabelFontSize: 8,
    showValue: true,
    showLegend: true,
    showTitle: false,
    valAxisMinVal: 0,
    valAxisMaxVal: 240,
    valAxisMajorUnit: 40,
    showCatName: false,
    showValAxis: true,
    showCatAxis: true,
    valAxisTitle: '万元',
    dataLabelPosition: 'outEnd',
    chartColors: [C.green, C.cyan],
    roundedCorners: false,
    showCategoryName: false,
    legendPos: 'b',
  });
  rect(slide, 8.0, 2.28, 3.75, 3.6, C.panel, C.panel2, 0, true);
  addText(slide, '测算逻辑', 8.35, 2.65, 2.2, 0.28, { size: 15, bold: true, color: C.green });
  addBullets(slide, [
    '2026：2-3 个 PoC 试点，完成模板化交付',
    '2027：扩展校园/园区客户，形成模块授权',
    '2028：沉淀行业场景包，服务收入提升',
  ], 8.38, 3.18, 2.95, { gap: 0.58, size: 9.8 });
  addText(slide, '关键指标：毛利率随标准化提升；研发投入集中在数据适配、算法分析和部署工具链。', 8.35, 5.22, 3.0, 0.36, { size: 9.5, color: C.muted });
  addText(slide, '单位：万元；本页为赛事商业计划测算，不代表已签约收入。', 0.92, 6.24, 6.2, 0.22, { size: 8.5, color: C.dim });

  previewJobs.push(writePreview(11, [
    ...previewBase('从试点收入到模块化复制，形成轻资产增长曲线', '三年预测为路演测算口径，可按真实试点校准'),
    svgRect(160, 335, 980, 460, `#${C.panel}`, `#${C.panel2}`, 22),
    svgRect(280, 670, 70, -80, `#${C.green}`),
    svgRect(430, 670, 70, -240, `#${C.green}`),
    svgRect(580, 670, 70, -410, `#${C.green}`),
    svgRect(760, 670, 70, -35, `#${C.cyan}`),
    svgRect(910, 670, 70, -180, `#${C.cyan}`),
    svgRect(1060, 670, 70, -520, `#${C.cyan}`),
    svgText('项目制收入 + 授权与服务收入', 300, 760, 30, `#${C.text}`, 700),
    svgText('测算逻辑：PoC → 模块授权 → 行业场景包', 1230, 520, 34, `#${C.green}`, 700),
  ]));
}

function slideTeamAndAsk() {
  const slide = pptx.addSlide();
  slide.background = { color: C.ink };
  addTitle(slide, '11 团队与赛事补强', '把技术原型包装成“可信团队 + 可落地项目”', '本页保留可编辑占位，赛前把真实成员、成果、指导教师和平台资源补齐即可。', 12);
  const leftItems = [
    ['项目负责人', '姓名/专业/年级/职责待填写'],
    ['技术开发', '前端可视化、后端 API、Python 场景生成'],
    ['商业与调研', '市场访谈、竞品分析、财务测算'],
    ['指导资源', '校内导师、实验室、产业顾问待填写'],
  ];
  leftItems.forEach(([role, desc], i) => {
    const y = 2.25 + i * 0.76;
    addText(slide, role, 0.9, y, 1.35, 0.25, { size: 12, bold: true, color: [C.green, C.cyan, C.amber, C.red][i] });
    addText(slide, desc, 2.45, y, 4.4, 0.25, { size: 11.2, color: C.text });
  });
  rect(slide, 7.55, 2.22, 4.5, 2.7, C.panel, C.panel2, 0, true);
  addText(slide, '赛前必须补齐', 7.88, 2.6, 2.5, 0.28, { size: 15, bold: true, color: C.amber });
  addBullets(slide, [
    '真实市场调研访谈记录与痛点证据',
    '应用证明或试用截图 2-3 个',
    '软著、论文、专利、获奖等成果',
    '股权结构、融资需求、三年计划',
  ], 7.9, 3.06, 3.65, { gap: 0.46, size: 9.4, color: C.amber });
  addText(slide, '收束句：我们不是做一张“漂亮地图”，而是做面向复杂网络的态势感知、快速定位和历史复盘基础平台。', 0.92, 5.92, 10.45, 0.42, { size: 15, bold: true, color: C.green, align: 'center' });

  previewJobs.push(writePreview(12, [
    ...previewBase('把技术原型包装成“可信团队 + 可落地项目”', '成员、成果、指导教师和平台资源保留待填写占位'),
    svgText('项目负责人 / 技术开发 / 商业调研 / 指导资源', 150, 440, 38, `#${C.text}`, 700),
    svgText('赛前补齐：调研记录、应用证明、软著论文专利、股权融资', 150, 640, 34, `#${C.amber}`, 700),
    svgText('不是漂亮地图，而是复杂网络态势感知基础平台', 150, 820, 40, `#${C.green}`, 800),
  ]));
}

slideCover();
slideProblem();
slideProduct();
slideArchitecture();
slidePrototype();
slideInnovation();
slideMarket();
slideBusiness();
slideCompetition();
slideGoToMarket();
slideFinance();
slideTeamAndAsk();

(async () => {
  await pptx.writeFile({ fileName: outputPptx });
  await Promise.all(previewJobs);
  console.log(JSON.stringify({
    pptx: outputPptx,
    previews: previewDir,
    slideCount: pptx._slides.length,
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
