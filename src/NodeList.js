// NodeList.js - 节点列表组件（带展开 / 收起）
import React, { useState } from 'react';
import {
  RadioTower,
  Drone,
  Users,
  Satellite,
  ListTree,
  ChevronLeft,
  ChevronRight,
  Circle,
} from 'lucide-react';

// 这是一个函数式组件，接收 props：
// - props.nodes: 节点数组
// - props.defaultCollapsed: 可选，初始是否折叠（布尔）
// - props.collapsed: （可选）受控折叠状态，如果提供组件将变为受控组件
// - props.onToggle: （可选）当用户点击切换时调用，接收新布尔值
// - props.typeMeta: （可选）节点类型元数据映射，用于显示友好名称与颜色
function NodeList(props) {
  const [internalCollapsed, setInternalCollapsed] = useState(!!props.defaultCollapsed);
  const nodes = props.nodes || [];
  const typeMetaMap = props.typeMeta || {};

  const isControlled = props.collapsed !== undefined;
  const collapsed = isControlled ? !!props.collapsed : internalCollapsed;

  const iconMap = {
    'ground-station': RadioTower,
    uav: Drone,
    'ground-user': Users,
    satellite: Satellite,
  };

  function toggle() {
    const next = !collapsed;
    if (isControlled) {
      props.onToggle && props.onToggle(next);
    } else {
      setInternalCollapsed(next);
    }
  }

  return (
    <div className={`node-list-root flex h-full w-full flex-col ${collapsed ? 'items-center justify-between gap-6 py-6' : 'p-6'}`}>
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

      {!collapsed ? (
        <ul className="mt-6 flex flex-1 flex-col gap-4 overflow-y-auto pr-1">
          {nodes.map((node) => {
            const meta = typeMetaMap[node.type] || { label: node.type || '未知类型', color: '#7f7f7f' };
            const TypeIcon = iconMap[node.type] || Circle;
            const accentColor = meta.color || '#7f7f7f';
            return (
              <li
                key={node.id}
                className="group relative flex items-center gap-4 rounded-2xl border border-white/15 bg-white/10 px-4 py-4 shadow-soft-glow backdrop-blur-lg transition duration-200 hover:border-aurora-green/60 hover:bg-aurora-green/10"
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
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[10px] tracking-[0.3em] text-aurora-green/60">
          <span className="h-12 w-12 rounded-full border border-aurora-green/40 bg-aurora-green/5" />
          <span className="uppercase">Node Index</span>
        </div>
      )}
    </div>
  );
}

export default NodeList;
