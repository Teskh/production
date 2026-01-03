export type StationSummary = {
  id: number;
  name: string;
  role: string;
  line_type: string | null;
  sequence_order: number | null;
};

export type StationContext =
  | { kind: 'station'; stationId: number }
  | { kind: 'panel_line' }
  | { kind: 'aux' }
  | { kind: 'assembly_sequence'; sequenceOrder: number };

export const STATION_CONTEXT_STORAGE_KEY = 'selectedStationContext';
export const SPECIFIC_STATION_ID_STORAGE_KEY = 'selectedSpecificStationId';
export const AUTOFOCUS_PREV_CONTEXT_KEY = 'autoFocusPrevStationContext';

export const parseStationContext = (value: string | null): StationContext | null => {
  if (!value) {
    return null;
  }
  if (value.startsWith('station:')) {
    const id = Number(value.slice('station:'.length));
    if (!Number.isNaN(id)) {
      return { kind: 'station', stationId: id };
    }
    return null;
  }
  if (value === 'panel_line') {
    return { kind: 'panel_line' };
  }
  if (value === 'aux') {
    return { kind: 'aux' };
  }
  if (value.startsWith('assembly_sequence:')) {
    const order = Number(value.slice('assembly_sequence:'.length));
    if (!Number.isNaN(order)) {
      return { kind: 'assembly_sequence', sequenceOrder: order };
    }
  }
  return null;
};

export const formatStationContext = (context: StationContext): string => {
  if (context.kind === 'station') {
    return `station:${context.stationId}`;
  }
  if (context.kind === 'panel_line') {
    return 'panel_line';
  }
  if (context.kind === 'aux') {
    return 'aux';
  }
  return `assembly_sequence:${context.sequenceOrder}`;
};

export const formatStationLabel = (station: StationSummary): string => {
  const lineLabel =
    station.role === 'Assembly' && station.line_type ? ` - Line ${station.line_type}` : '';
  return `${station.name}${lineLabel}`;
};

export const isStationInContext = (
  station: StationSummary,
  context: StationContext
): boolean => {
  if (context.kind === 'station') {
    return station.id === context.stationId;
  }
  if (context.kind === 'panel_line') {
    return station.role === 'Panels';
  }
  if (context.kind === 'aux') {
    return station.role === 'AUX';
  }
  return (
    station.role === 'Assembly' && station.sequence_order === context.sequenceOrder
  );
};

const sequenceValue = (value: number | null) =>
  value === null ? Number.POSITIVE_INFINITY : value;

export const getStationsForContext = (
  stations: StationSummary[],
  context: StationContext
): StationSummary[] => {
  const filtered = stations.filter((station) => isStationInContext(station, context));
  if (context.kind === 'panel_line') {
    return filtered.sort((a, b) => sequenceValue(a.sequence_order) - sequenceValue(b.sequence_order));
  }
  if (context.kind === 'aux') {
    return filtered.sort((a, b) => {
      const seq = sequenceValue(a.sequence_order) - sequenceValue(b.sequence_order);
      if (seq !== 0) {
        return seq;
      }
      return a.name.localeCompare(b.name);
    });
  }
  if (context.kind === 'assembly_sequence') {
    return filtered.sort((a, b) => a.id - b.id);
  }
  return filtered;
};

export const getAssemblySequenceOrders = (stations: StationSummary[]): number[] => {
  const orders = new Set<number>();
  stations.forEach((station) => {
    if (station.role === 'Assembly' && station.sequence_order !== null) {
      orders.add(station.sequence_order);
    }
  });
  return Array.from(orders).sort((a, b) => a - b);
};

export const getContextLabel = (
  context: StationContext | null,
  stations: StationSummary[]
): string => {
  if (!context) {
    return 'No context selected';
  }
  if (context.kind === 'panel_line') {
    return 'Panel line';
  }
  if (context.kind === 'aux') {
    return 'Auxiliary';
  }
  if (context.kind === 'assembly_sequence') {
    const station = stations.find(
      (item) =>
        item.role === 'Assembly' && item.sequence_order === context.sequenceOrder
    );
    return station ? `Assembly - ${station.name}` : `Assembly sequence ${context.sequenceOrder}`;
  }
  const station = stations.find((item) => item.id === context.stationId);
  return station ? formatStationLabel(station) : `Station ${context.stationId}`;
};
