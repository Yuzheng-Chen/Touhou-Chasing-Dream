/** Distinct, harmonious seat colours (up to 8 players). */
export const SEAT_COLORS = ['#f0776c', '#f0a64d', '#e3cf5c', '#6fcf8e', '#5cc3d9', '#7a9af0', '#b287f0', '#f07ab8'];
export const playerColor = (seat: number) => SEAT_COLORS[seat % SEAT_COLORS.length];
