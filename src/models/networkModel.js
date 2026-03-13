/**
 * @typedef {Object} Node
 * @property {string} id
 * @property {string} name
 * @property {'router'|'base-station'|'mesh-node'|'terminal'|'satellite'} type
 * @property {'backbone'|'access'|'mesh'|'edge'} layer
 * @property {{geo:{lat:number,lng:number,altitude:number}}} location
 * @property {{online:boolean,status:string,lastSeen?:string}} state
 */

/**
 * @typedef {Object} Link
 * @property {string} id
 * @property {string} from
 * @property {string} to
 * @property {'wired'|'wireless'} type
 * @property {number} bandwidthMbps
 * @property {number} delayMs
 * @property {number} lossRate
 * @property {number=} snrDb
 * @property {number=} utilization
 */

/**
 * @typedef {Object} CrossLayerRelation
 * @property {string} id
 * @property {string} fromNodeId
 * @property {string} toNodeId
 * @property {'access'|'backhaul'|'relay'} relationType
 * @property {string=} notes
 */

export function createNode(node) {
  return node;
}

export function createLink(link) {
  return link;
}

export function createCrossLayerRelation(relation) {
  return relation;
}

export function createTopology({ meta, nodes, links, crossLayerRelations }) {
  return {
    meta,
    nodes,
    links,
    crossLayerRelations,
  };
}
