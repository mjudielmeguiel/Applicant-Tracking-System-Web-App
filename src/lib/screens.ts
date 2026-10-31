import 'server-only';
import definitions from './generated/screens.json';
import type { ScreenDefinition, ScreenName } from '@/types';

export function getScreen(name: ScreenName): ScreenDefinition {
  return definitions[name];
}
