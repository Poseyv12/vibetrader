/** Theme types/defaults shared by server settings and client components —
 *  keep this module free of Node imports (fs etc.). */

export interface UiTheme {
  accent: string;
  up: string;
  down: string;
  amber: string;
}

export const DEFAULT_THEME: UiTheme = {
  accent: "#22d3ee",
  up: "#26a69a",
  down: "#ef5350",
  amber: "#eda100",
};
