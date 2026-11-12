// Shared number, currency, and date formatters for Usage and Insights views.
import { locale } from "../language";

export const compactCount = (n: number, loc: string = locale()): string =>
  new Intl.NumberFormat(loc, { notation: "compact", maximumFractionDigits: 1 }).format(n);

export const formatUsd = (usd: number, maximumFractionDigits?: number, loc: string = locale()): string =>
  new Intl.NumberFormat(loc, {
    style: "currency",
    currency: "USD",
    ...(maximumFractionDigits == null ? {} : { maximumFractionDigits }),
  }).format(usd);

export const formatDayMedium = (day: string, loc: string = locale()): string =>
  new Date(`${day}T12:00:00`).toLocaleDateString(loc, { dateStyle: "medium" });
