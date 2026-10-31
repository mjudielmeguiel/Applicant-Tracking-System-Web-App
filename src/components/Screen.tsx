import { getScreen } from '@/lib/screens';
import type { ScreenName } from '@/types';
import ScreenRuntime from './ScreenRuntime';

export default function Screen({ name }: { name: ScreenName }) {
  const screen = getScreen(name);
  return <>
    {screen.styles.map(href => <link key={href} rel="stylesheet" href={href} />)}
    <div dangerouslySetInnerHTML={{ __html: screen.html }} />
    <ScreenRuntime name={name} scripts={screen.scripts} bodyClass={screen.bodyClass} />
  </>;
}
