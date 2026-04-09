// NodeList.js - 鑺傜偣鍒楄〃缁勪欢锛堝甫灞曞紑 / 鏀惰捣锛?
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  RadioTower,
  Server,
  Camera,
  Users,
  ListTree,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Circle,
  Layers,
  LayoutGrid,
} from 'lucide-react';

const GROUP_MODE_OPTIONS = [
  { key: 'layer', label: 'Group By Layer', icon: Layers },
  { key: 'type', label: 'Group By Type', icon: LayoutGrid },
];

const LAYER_META = {
  backbone: { label: 'Core Network', color: '#60a5fa' },
  access: { label: 'Aggregation Layer', color: '#22d3ee' },
  mesh: { label: 'Edge Transport', color: '#34d399' },
  edge: { label: 'Access Sensing', color: '#f97316' },
};

const LAYER_ORDER = ['backbone', 'access', 'mesh', 'edge'];
const TYPE_ORDER = [
  'network-center',
  'campus-gateway',
  'building-gateway',
  'edge-server',
  'camera',
  'env-sensor',
  'access-control',
  'smart-meter',
  'streetlight-controller',
  'parking-sensor',
  'lab-terminal',
  'classroom-terminal',
  'dorm-device',
  'security-platform',
  'iot-device',
];
const EMPTY_ARRAY = [];
const EMPTY_OBJECT = {};
const LIST_SCROLL_DELAY_MS = 320;

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

// 杩欐槸涓€涓嚱鏁板紡缁勪欢锛屾帴鏀?props锛?
// - props.nodes: 鑺傜偣鏁扮粍
// - props.defaultCollapsed: 鍙€夛紝鍒濆鏄惁鎶樺彔锛堝竷灏旓級
// - props.collapsed: 锛堝彲閫夛級鍙楁帶鎶樺彔鐘舵€侊紝濡傛灉鎻愪緵缁勪欢灏嗗彉涓哄彈鎺х粍浠?
// - props.onToggle: 锛堝彲閫夛級褰撶敤鎴风偣鍑诲垏鎹㈡椂璋冪敤锛屾帴鏀舵柊甯冨皵鍊?
// - props.typeMeta: 锛堝彲閫夛級鑺傜偣绫诲瀷鍏冩暟鎹槧灏勶紝鐢ㄤ簬鏄剧ず鍙嬪ソ鍚嶇О涓庨鑹?
function NodeList(props) {
  const [internalCollapsed, setInternalCollapsed] = useState(!!props.defaultCollapsed);
  const nodes = props.nodes ?? EMPTY_ARRAY;
  const typeMetaMap = props.typeMeta ?? EMPTY_OBJECT;
  const onToggle = props.onToggle;
  const onSelectNode = props.onSelectNode;

  const iconMap = {
    'network-center': Server,
    'campus-gateway': RadioTower,
    'building-gateway': RadioTower,
    'edge-server': Server,
    camera: Camera,
    'env-sensor': Camera,
    'access-control': RadioTower,
    'smart-meter': Server,
    'streetlight-controller': RadioTower,
    'parking-sensor': Camera,
    'lab-terminal': Users,
    'classroom-terminal': Users,
    'dorm-device': Users,
    'library-terminal': Users,
    'security-platform': Server,
    'iot-device': Users,
  };

  const [groupMode, setGroupMode] = useState(GROUP_MODE_OPTIONS[0].key);
  const [groupCollapseState, setGroupCollapseState] = useState({
    layer: {},
    type: {},
  });
  const selectedNodeId = props.selectedNodeId;
  const focusedNodeId = props.focusedNodeId;
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null;
  const selectedMeta = selectedNode ? typeMetaMap[selectedNode.type] : null;
  const SelectedCollapsedIcon = selectedNode ? iconMap[selectedNode.type] || Circle : Circle;
  const itemRefsById = useRef({});
  const revealTimerRef = useRef(null);

  const isControlled = props.collapsed !== undefined;
  const collapsed = isControlled ? !!props.collapsed : internalCollapsed;

  function toggle() {
    const next = !collapsed;
    if (isControlled) {
      onToggle && onToggle(next);
    } else {
      setInternalCollapsed(next);
    }
  }

  function handleSelect(nodeId) {
    onSelectNode && onSelectNode(nodeId);
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
          const meta = LAYER_META[key] || { label: key || 'Other Layer', color: '#7f7f7f' };
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
        const meta = typeMetaMap[key] || { label: key || 'Other Type', color: '#7f7f7f' };
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

  useEffect(() => {
    return () => {
      if (revealTimerRef.current) {
        clearTimeout(revealTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedNode) {
      return;
    }

    if (collapsed) {
      if (isControlled) {
        onToggle && onToggle(false);
      } else {
        setInternalCollapsed(false);
      }
    }

    const targetGroupKey = groupMode === 'layer'
      ? (selectedNode.layer || 'other')
      : (selectedNode.type || 'other');

    setGroupCollapseState((prev) => {
      const modeState = prev[groupMode] || {};
      if (modeState[targetGroupKey] === false) {
        return prev;
      }
      return {
        ...prev,
        [groupMode]: {
          ...modeState,
          [targetGroupKey]: false,
        },
      };
    });
  }, [collapsed, groupMode, isControlled, onToggle, selectedNode]);

  useEffect(() => {
    if (!selectedNode || collapsed) {
      return;
    }

    const targetGroupKey = groupMode === 'layer'
      ? (selectedNode.layer || 'other')
      : (selectedNode.type || 'other');
    const isTargetGroupCollapsed = !!currentGroupCollapse[targetGroupKey];
    const delay = isTargetGroupCollapsed ? LIST_SCROLL_DELAY_MS : 90;

    if (revealTimerRef.current) {
      clearTimeout(revealTimerRef.current);
    }

    revealTimerRef.current = setTimeout(() => {
      const targetEl = itemRefsById.current[selectedNode.id];
      if (!targetEl) {
        return;
      }
      targetEl.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest',
      });
    }, delay);

    return () => {
      if (revealTimerRef.current) {
        clearTimeout(revealTimerRef.current);
      }
    };
  }, [collapsed, currentGroupCollapse, groupMode, selectedNode]);

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
            <p className="text-xs uppercase tracking-[0.35em]" style={{ color: '#576690b3' }}>Node Cluster</p>
            <h3 className="mt-3 text-lg font-semibold text-slate-900">
              Network Node List <span className="ml-2 text-sm font-normal text-emerald-700">({nodes.length})</span>
            </h3>
          </div>
        ) : (
          <ListTree className="h-6 w-6" style={{ color: '#576690' }} />
        )}
        <div className={`flex ${collapsed ? 'flex-col gap-3' : 'items-center gap-3'}`}>
          <button
            onClick={cycleGroupMode}
            className={`flex items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 text-xs uppercase tracking-[0.25em] transition ${
              collapsed ? 'h-10 w-10 p-0' : 'px-3 py-1.5'
            }`}
            style={{ 
              color: '#576690',
              borderColor: collapsed ? undefined : '#57669060',
              backgroundColor: collapsed ? undefined : '#57669010'
            }}
            onMouseEnter={(e) => {
              e.target.style.borderColor = '#57669099';
              e.target.style.backgroundColor = '#57669020';
            }}
            onMouseLeave={(e) => {
              e.target.style.borderColor = collapsed ? 'rgba(255,255,255,0.2)' : '#57669060';
              e.target.style.backgroundColor = collapsed ? 'rgba(255,255,255,0.1)' : '#57669010';
            }}
            aria-label={`Switch group mode, current: ${currentGroupOption.label}`}
          >
            <GroupModeIcon className="h-4 w-4" />
            {!collapsed && <span>{currentGroupOption.label}</span>}
          </button>
          <button
            onClick={toggle}
            className="group flex items-center justify-center rounded-full border p-2 transition"
            style={{
              borderColor: '#57669066',
              backgroundColor: '#57669019',
              color: '#576690'
            }}
            onMouseEnter={(e) => {
              e.target.style.borderColor = '#576690';
              e.target.style.backgroundColor = '#57669033';
            }}
            onMouseLeave={(e) => {
              e.target.style.borderColor = '#57669066';
              e.target.style.backgroundColor = '#57669019';
            }}
            aria-label={collapsed ? 'Expand node list' : 'Collapse node list'}
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
                  className="group flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-left backdrop-blur-md transition focus:outline-none focus:ring-2"
                  style={{
                    '--hover-border': '#57669099',
                    '--hover-bg': '#57669019',
                    '--focus-ring': '#576690b3'
                  }}
                  onMouseEnter={(e) => {
                    e.target.style.borderColor = '#57669099';
                    e.target.style.backgroundColor = '#57669019';
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.borderColor = 'rgba(255,255,255,0.1)';
                    e.target.style.backgroundColor = 'rgba(255,255,255,0.05)';
                  }}
                  onFocus={(e) => {
                    e.target.style.boxShadow = `0 0 0 2px #576690b3`;
                  }}
                  onBlur={(e) => {
                    e.target.style.boxShadow = 'none';
                  }}
                  aria-expanded={!isGroupCollapsed}
                >
                  <span className="flex items-center gap-3">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: group.color || '#7f7f7f' }}
                    />
                    <span className="flex items-center gap-2 text-sm font-semibold tracking-[0.25em] text-emerald-700">
                      {group.label}
                      <span className="text-[10px] font-normal tracking-normal text-slate-600">
                        ({group.nodes.length})
                      </span>
                    </span>
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 transition-transform duration-200 ${
                      isGroupCollapsed ? '-rotate-90' : 'rotate-0'
                    }`}
                    style={{ color: '#576690' }}
                  />
                </button>
                <CollapsibleSection isOpen={!isGroupCollapsed}>
                  <ul className="flex flex-col gap-4 pt-3">
                    {group.nodes.map((node) => {
                      const meta = typeMetaMap[node.type] || { label: node.type || 'Unknown Type', color: '#7f7f7f' };
                      const TypeIcon = iconMap[node.type] || Circle;
                      const accentColor = meta.color || '#7f7f7f';
                      const isSelected = selectedNodeId === node.id;
                      const isFocused = focusedNodeId === node.id;
                      const isHighlighted = isSelected || isFocused;
                      return (
                        <li
                          key={node.id}
                          ref={(el) => {
                            if (el) {
                              itemRefsById.current[node.id] = el;
                            } else {
                              delete itemRefsById.current[node.id];
                            }
                          }}
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
                          className={`node-list-item group relative flex items-center gap-4 rounded-2xl border px-4 py-4 shadow-soft-glow backdrop-blur-lg transition duration-200 focus:outline-none focus:ring-2 ${
                            isHighlighted
                              ? ''
                              : 'border-white/15 bg-white/10'
                          } ${isSelected ? 'node-list-item--selected' : ''} ${isFocused ? 'node-list-item--focused' : ''}`}
                          style={{
                            borderColor: isFocused ? '#22d3eecc' : (isSelected ? '#576690cc' : undefined),
                            backgroundColor: isFocused ? '#22d3ee1a' : (isSelected ? '#57669019' : undefined),
                            '--ring-color': '#576690b3',
                            boxShadow: isFocused
                              ? `0 0 0 1px #22d3ee88, 0 20px 35px -18px ${accentColor}66`
                              : `0 20px 35px -18px ${accentColor}55`,
                          }}
                          onMouseEnter={(e) => {
                            if (!isHighlighted) {
                              e.currentTarget.style.borderColor = '#57669099';
                              e.currentTarget.style.backgroundColor = '#57669019';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isHighlighted) {
                              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)';
                              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                            }
                          }}
                          onFocus={(e) => {
                            e.currentTarget.style.boxShadow = '0 0 0 2px #576690b3';
                          }}
                          onBlur={(e) => {
                            e.currentTarget.style.boxShadow = isFocused
                              ? `0 0 0 1px #22d3ee88, 0 20px 35px -18px ${accentColor}66`
                              : `0 20px 35px -18px ${accentColor}55`;
                          }}
                        >
                          <span
                            aria-hidden="true"
                            className={`pointer-events-none absolute left-0 top-2 bottom-2 w-1 rounded-r-full transition-opacity duration-200 ${
                              isHighlighted ? 'opacity-100' : 'opacity-0'
                            }`}
                            style={{ backgroundColor: isFocused ? '#22d3ee' : '#576690' }}
                          />
                          <span className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-deep-navy/40 ring-1 ring-inset ring-white/20">
                            <TypeIcon className="h-6 w-6" style={{ color: '#576690' }} />
                            <span
                              className="absolute inset-0 rounded-xl"
                              style={{
                                background: `radial-gradient(circle at 50% 50%, ${accentColor}40, transparent 70%)`,
                                opacity: 0.35,
                              }}
                            />
                          </span>
                          <div className="flex flex-1 flex-col">
                            <span className="text-base font-semibold text-slate-900">{node.name}</span>
                            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-700">
                              <span
                                className="rounded-full px-2 py-1 text-[11px] font-medium uppercase tracking-wider"
                                style={{
                                  backgroundColor: `${accentColor}22`,
                                  color: accentColor,
                                }}
                              >
                                {meta.label}
                              </span>
                              <span className="flex items-center gap-1 text-slate-600">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                                Layer: {node.layer || 'unknown'}
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
        <div className="flex flex-1 flex-col items-center justify-center gap-5" style={{ color: '#576690b3' }}>
            <span
              className="relative flex h-12 w-12 items-center justify-center rounded-full border border-aurora-green/40 bg-aurora-green/5"
              title={selectedNode ? `${selectedNode.name} - ${selectedMeta ? selectedMeta.label : 'Unknown Type'}` : 'No Node Selected'}
            >
            <SelectedCollapsedIcon className="h-6 w-6" style={{ color: '#576690' }} />
          </span>
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/10">
            <GroupModeIcon className="h-4 w-4" style={{ color: '#576690' }} />
          </span>
          <span className="flex h-10 w-10 items-center justify-center rounded-full border" style={{ borderColor: '#5766904d', backgroundColor: '#57669019' }}>
            <ListTree className="h-4 w-4" style={{ color: '#576690' }} />
          </span>
        </div>
      )}
    </div>
  );
}

export default React.memo(NodeList);

