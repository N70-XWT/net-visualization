// NodeList.js - 节点列表组件（带展开 / 收起）
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  RadioTower,
  Drone,
  Users,
  Satellite,
  ListTree,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Circle,
  Layers,
  LayoutGrid,
} from 'lucide-react';

const GROUP_MODE_OPTIONS = [
  { key: 'layer', label: '按网络层级', icon: Layers },
  { key: 'type', label: '按节点类型', icon: LayoutGrid },
];

const LAYER_META = {
  backbone: { label: '骨干网', color: '#1f78b4' },
  air: { label: '自组网', color: '#f28e2b' },
  access: { label: '接入网', color: '#59a14f' },
  space: { label: '空天节点', color: '#9467bd' },
};

const LAYER_ORDER = ['backbone', 'air', 'access', 'space'];
const TYPE_ORDER = ['ground-station', 'ground-user', 'uav', 'satellite'];
const EMPTY_ARRAY = [];
const EMPTY_OBJECT = {};

function CollapsibleSection({ isOpen, children }) {
  const containerRef = useRef(null);
  const [inlineStyle, setInlineStyle] = useState({
    maxHeight: isOpen ? '2000px' : '0px',
    opacity: isOpen ? 1 : 0,
  });
  const childCount = React.Children.count(children);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }

    const scrollHeight = el.scrollHeight;

    if (isOpen) {
      setInlineStyle({
        maxHeight: `${scrollHeight}px`,
        opacity: 1,
      });

      const timeout = setTimeout(() => {
        setInlineStyle({
          maxHeight: '2000px',
          opacity: 1,
        });
      }, 320);

      return () => clearTimeout(timeout);
    }

    setInlineStyle((prev) => ({
      maxHeight: `${scrollHeight || 0}px`,
      opacity: prev.opacity,
    }));

    const raf = requestAnimationFrame(() => {
      setInlineStyle({
        maxHeight: '0px',
        opacity: 0,
      });
    });

    return () => cancelAnimationFrame(raf);
  }, [isOpen, childCount]);

  return (
    <div
      ref={containerRef}
      style={inlineStyle}
      className="overflow-hidden transition-all duration-300 ease-out"
    >
      {children}
    </div>
  );
}

// 这是一个函数式组件，接收 props：
// - props.nodes: 节点数组
// - props.defaultCollapsed: 可选，初始是否折叠（布尔）
// - props.collapsed: （可选）受控折叠状态，如果提供组件将变为受控组件
// - props.onToggle: （可选）当用户点击切换时调用，接收新布尔值
// - props.typeMeta: （可选）节点类型元数据映射，用于显示友好名称与颜色
function NodeList(props) {
  const [internalCollapsed, setInternalCollapsed] = useState(!!props.defaultCollapsed);
  const nodes = props.nodes ?? EMPTY_ARRAY;
  const typeMetaMap = props.typeMeta ?? EMPTY_OBJECT;

  const iconMap = {
    'ground-station': RadioTower,
    uav: Drone,
    'ground-user': Users,
    satellite: Satellite,
  };

  const [groupMode, setGroupMode] = useState(GROUP_MODE_OPTIONS[0].key);
  const [groupCollapseState, setGroupCollapseState] = useState({
    layer: {},
    type: {},
  });
  const selectedNodeId = props.selectedNodeId;
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null;
  const selectedMeta = selectedNode ? typeMetaMap[selectedNode.type] : null;
  const SelectedCollapsedIcon = selectedNode ? iconMap[selectedNode.type] || Circle : Circle;

  const isControlled = props.collapsed !== undefined;
  const collapsed = isControlled ? !!props.collapsed : internalCollapsed;

  function toggle() {
    const next = !collapsed;
    if (isControlled) {
      props.onToggle && props.onToggle(next);
    } else {
      setInternalCollapsed(next);
    }
  }

  function handleSelect(nodeId) {
    props.onSelectNode && props.onSelectNode(nodeId);
  }

  function cycleGroupMode() {
    const currentIndex = GROUP_MODE_OPTIONS.findIndex((option) => option.key === groupMode);
    const nextOption = GROUP_MODE_OPTIONS[(currentIndex + 1) % GROUP_MODE_OPTIONS.length];
    setGroupMode(nextOption.key);
  }

  function toggleGroupSection(groupKey) {
    setGroupCollapseState((prev) => {
      const modeState = prev[groupMode] || {};
      return {
        ...prev,
        [groupMode]: {
          ...modeState,
          [groupKey]: !modeState[groupKey],
        },
      };
    });
  }

  const groupedNodes = useMemo(() => {
    if (!nodes.length) {
      return [];
    }

    if (groupMode === 'layer') {
      const groupsMap = nodes.reduce((acc, node) => {
        const key = node.layer || 'other';
        if (!acc[key]) {
          const meta = LAYER_META[key] || { label: key || '其它层级', color: '#7f7f7f' };
          acc[key] = {
            key,
            label: meta.label,
            color: meta.color,
            nodes: [],
          };
        }
        acc[key].nodes.push(node);
        return acc;
      }, {});

      const orderedKeys = [...LAYER_ORDER, ...Object.keys(groupsMap).filter((k) => !LAYER_ORDER.includes(k))];
      return orderedKeys
        .filter((key) => groupsMap[key])
        .map((key) => groupsMap[key]);
    }

    const groupsMap = nodes.reduce((acc, node) => {
      const key = node.type || 'other';
      if (!acc[key]) {
        const meta = typeMetaMap[key] || { label: key || '其它类型', color: '#7f7f7f' };
        acc[key] = {
          key,
          label: meta.label,
          color: meta.color || '#7f7f7f',
          nodes: [],
        };
      }
      acc[key].nodes.push(node);
      return acc;
    }, {});

    const orderedKeys = [...TYPE_ORDER, ...Object.keys(groupsMap).filter((k) => !TYPE_ORDER.includes(k))];
    return orderedKeys
      .filter((key) => groupsMap[key])
      .map((key) => groupsMap[key]);
  }, [groupMode, nodes, typeMetaMap]);

  const currentGroupOption = GROUP_MODE_OPTIONS.find((option) => option.key === groupMode) || GROUP_MODE_OPTIONS[0];
  const currentGroupCollapse = groupCollapseState[groupMode] || EMPTY_OBJECT;
  const GroupModeIcon = currentGroupOption.icon;

  return (
    <div
      className={`node-list-root flex h-full w-full flex-col ${
        collapsed ? 'items-center gap-6 py-6 overflow-hidden' : 'p-6'
      }`}
    >
      <div
        className={`flex w-full items-center ${collapsed ? 'flex-col gap-4' : 'justify-between gap-4'}`}
      >
        {!collapsed ? (
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-aurora-green/70">Node Cluster</p>
            <h3 className="mt-3 text-lg font-semibold text-slate-50">
              节点列表 <span className="ml-2 text-sm font-normal text-aurora-green/80">({nodes.length})</span>
            </h3>
          </div>
        ) : (
          <ListTree className="h-6 w-6 text-aurora-green" />
        )}
        <div className={`flex ${collapsed ? 'flex-col gap-3' : 'items-center gap-3'}`}>
          <button
            onClick={cycleGroupMode}
            className={`flex items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 text-xs uppercase tracking-[0.25em] text-aurora-green transition hover:border-aurora-green/60 hover:bg-aurora-green/10 ${
              collapsed ? 'h-10 w-10 p-0' : 'px-3 py-1.5'
            }`}
            aria-label={`切换分组模式，当前：${currentGroupOption.label}`}
          >
            <GroupModeIcon className="h-4 w-4" />
            {!collapsed && <span>{currentGroupOption.label}</span>}
          </button>
          <button
            onClick={toggle}
            className="group flex items-center justify-center rounded-full border border-aurora-green/40 bg-aurora-green/10 p-2 text-aurora-green transition hover:border-aurora-green hover:bg-aurora-green/20"
            aria-label={collapsed ? '展开节点列表' : '收起节点列表'}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {!collapsed ? (
        <div className="mt-6 flex flex-1 flex-col gap-6 overflow-y-auto pr-1">
          {groupedNodes.map((group) => {
            const isGroupCollapsed = !!currentGroupCollapse[group.key];
            return (
              <div key={group.key} className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => toggleGroupSection(group.key)}
                  className="group flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-left backdrop-blur-md transition hover:border-aurora-green/60 hover:bg-aurora-green/10 focus:outline-none focus:ring-2 focus:ring-aurora-green/70"
                  aria-expanded={!isGroupCollapsed}
                >
                  <span className="flex items-center gap-3">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: group.color || '#7f7f7f' }}
                    />
                    <span className="flex items-center gap-2 text-sm font-semibold tracking-[0.25em] text-aurora-green/80">
                      {group.label}
                      <span className="text-[10px] font-normal tracking-normal text-slate-200/70">
                        ({group.nodes.length})
                      </span>
                    </span>
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-aurora-green transition-transform duration-200 ${
                      isGroupCollapsed ? '-rotate-90' : 'rotate-0'
                    }`}
                  />
                </button>
                <CollapsibleSection isOpen={!isGroupCollapsed}>
                  <ul className="flex flex-col gap-4 pt-3">
                    {group.nodes.map((node) => {
                      const meta = typeMetaMap[node.type] || { label: node.type || '未知类型', color: '#7f7f7f' };
                      const TypeIcon = iconMap[node.type] || Circle;
                      const accentColor = meta.color || '#7f7f7f';
                      const isSelected = selectedNodeId === node.id;
                      return (
                        <li
                          key={node.id}
                          onClick={() => handleSelect(node.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              handleSelect(node.id);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          aria-pressed={isSelected}
                          className={`group relative flex items-center gap-4 rounded-2xl border px-4 py-4 shadow-soft-glow backdrop-blur-lg transition duration-200 focus:outline-none focus:ring-2 focus:ring-aurora-green/70 ${
                            isSelected
                              ? 'border-aurora-green/80 bg-aurora-green/10'
                              : 'border-white/15 bg-white/10 hover:border-aurora-green/60 hover:bg-aurora-green/10'
                          }`}
                          style={{ boxShadow: `0 20px 35px -18px ${accentColor}55` }}
                        >
                          <span className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-deep-navy/40 ring-1 ring-inset ring-white/20">
                            <TypeIcon className="h-6 w-6 text-aurora-green" />
                            <span
                              className="absolute inset-0 rounded-xl"
                              style={{
                                background: `radial-gradient(circle at 50% 50%, ${accentColor}40, transparent 70%)`,
                                opacity: 0.35,
                              }}
                            />
                          </span>
                          <div className="flex flex-1 flex-col">
                            <span className="text-base font-semibold text-slate-50">{node.name}</span>
                            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-300">
                              <span
                                className="rounded-full px-2 py-1 text-[11px] font-medium uppercase tracking-wider"
                                style={{
                                  backgroundColor: `${accentColor}22`,
                                  color: accentColor,
                                }}
                              >
                                {meta.label}
                              </span>
                              <span className="flex items-center gap-1 text-slate-300/90">
                                <span className="h-1.5 w-1.5 rounded-full bg-aurora-green" />
                                层级：{node.layer || '未知'}
                              </span>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </CollapsibleSection>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-aurora-green/70">
          <span
            className="relative flex h-12 w-12 items-center justify-center rounded-full border border-aurora-green/40 bg-aurora-green/5"
            title={selectedNode ? `${selectedNode.name} - ${selectedMeta ? selectedMeta.label : '未知类型'}` : '未选择节点'}
          >
            <SelectedCollapsedIcon className="h-6 w-6 text-aurora-green" />
          </span>
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/10">
            <GroupModeIcon className="h-4 w-4" />
          </span>
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-aurora-green/30 bg-aurora-green/10">
            <ListTree className="h-4 w-4" />
          </span>
        </div>
      )}
    </div>
  );
}

export default NodeList;
