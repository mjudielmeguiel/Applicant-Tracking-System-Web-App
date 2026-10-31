export type ScreenName = 'login' | 'dashboard' | 'applicants' | 'mrf' | 'users' | 'calendar' | 'invite';

export interface ScreenDefinition {
  title: string;
  bodyClass: string;
  html: string;
  styles: string[];
  scripts: string[];
}
