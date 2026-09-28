export const WORKDAYS_PER_MONTH = 20.83;

export type CostAssumptions = {
  salary: number; roster: number; overhead: number; uf: number;
  dailyHours: number; productivePercent: number; rate: number;
};
export type CostLine = { quantity: number; area: number | null; hours: number | null };
export type HistoricAreaLine = { completed: number; recordedArea: number; missingHouses: number;
  floorArea: number | null; exactArea: number | null };

export function historicArea(lines: HistoricAreaLine[]) {
  let total = 0;
  for (const line of lines) {
    if (line.completed === 0) continue;
    if (line.exactArea !== null && line.exactArea > 0) total += line.completed * line.exactArea;
    else if (line.missingHouses === 0) total += line.recordedArea;
    else if (line.floorArea !== null && line.floorArea > 0) total += line.recordedArea + line.missingHouses * line.floorArea;
    else return null;
  }
  return total;
}

export function forecastCosts(lines: CostLine[], a: CostAssumptions) {
  const used = lines.filter(l => l.quantity > 0);
  const quantity = used.reduce((s, l) => s + l.quantity, 0);
  const area = quantity && used.every(l => l.area !== null && l.area > 0)
    ? used.reduce((s, l) => s + l.quantity * l.area!, 0) : null;
  const hours = quantity && used.every(l => l.hours !== null && l.hours > 0)
    ? used.reduce((s, l) => s + l.quantity * l.hours!, 0) : null;
  const validCosts = a.roster > 0 && a.salary >= 0 && a.overhead >= 0;
  const dailyBurn = validCosts ? (a.roster * a.salary + a.overhead) / WORKDAYS_PER_MONTH : null;
  const days = quantity > 0 && a.rate > 0 ? quantity / a.rate : null;
  const totalClp = days !== null && dailyBurn !== null ? days * dailyBurn : null;
  const clpPerSqm = totalClp !== null && area ? totalClp / area : null;
  const ufPerSqm = clpPerSqm !== null && a.uf > 0 ? clpPerSqm / a.uf : null;
  const staff = hours !== null && days && a.dailyHours > 0 && a.dailyHours <= 24 && a.productivePercent > 0 && a.productivePercent <= 100
    ? hours / days / (a.dailyHours * a.productivePercent / 100) : null;
  return { quantity, area, hours, dailyBurn, days, totalClp, clpPerSqm, ufPerSqm, staff };
}

export function historicCosts(completedArea: number | null, projectHours: number,
  allHours: number, weekdays: number, a: CostAssumptions) {
  const share = allHours > 0 && projectHours > 0 ? projectHours / allHours : null;
  const burn = a.roster > 0 && a.salary >= 0 && a.overhead >= 0
    ? (a.roster * a.salary + a.overhead) / WORKDAYS_PER_MONTH : null;
  const totalClp = burn !== null && weekdays > 0 && share !== null ? burn * weekdays * share : null;
  const clpPerSqm = totalClp !== null && completedArea && completedArea > 0 ? totalClp / completedArea : null;
  return { share, totalClp, clpPerSqm, ufPerSqm: clpPerSqm !== null && a.uf > 0 ? clpPerSqm / a.uf : null };
}
