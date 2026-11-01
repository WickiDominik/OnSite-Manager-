import type { BcfCamera, Vec3 } from './types';

export interface ParsedTopic {
  guid: string;
  title: string;
  description: string;
  status?: string;
  priority?: string;
  type?: string;
  creationDate?: string;
  creationAuthor?: string;
  labels: string[];
  comments: { guid: string; date: string; author: string; text: string; viewpointGuid?: string }[];
  viewpoints: { guid: string; viewpoint?: string; snapshot?: string }[];
}

/** All descendants with the given local name (case-sensitive, namespace agnostic). */
const NS_FREE = (el: Element | Document, name: string): Element[] =>
  Array.from(el.getElementsByTagName('*')).filter((e) => e.localName === name);

function child(el: Element | undefined | null, name: string): Element | undefined {
  if (!el) return undefined;
  for (const c of Array.from(el.children)) if (c.localName === name || c.tagName === name) return c;
  return undefined;
}

function text(el: Element | undefined | null, name: string): string | undefined {
  const c = child(el, name);
  return c?.textContent ?? undefined;
}

export function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Ungültiges XML in BCF-Datei');
  return doc;
}

export function parseMarkup(xml: string, folderGuid: string): ParsedTopic {
  const doc = parseXml(xml);
  const topic = NS_FREE(doc, 'Topic')[0];
  if (!topic) throw new Error('markup.bcf ohne Topic');
  // BCF 2.x: <Markup><Comment Guid>…</Comment>, BCF 3.0: <Topic><Comments><Comment Guid>…
  const comments = NS_FREE(doc, 'Comment')
    .filter((c) => c.hasAttribute('Guid'))
    .map((c) => ({
      guid: c.getAttribute('Guid') ?? '',
      date: text(c, 'Date') ?? '',
      author: text(c, 'Author') ?? '',
      text: text(c, 'Comment') ?? '',
      viewpointGuid: child(c, 'Viewpoint')?.getAttribute('Guid') ?? undefined,
    }))
    .filter((c) => c.text.trim().length > 0);
  // BCF 2.x: <Markup><Viewpoints Guid>, BCF 3.0: <Topic><Viewpoints><ViewPoint Guid>
  const viewpoints = [...NS_FREE(doc, 'Viewpoints'), ...NS_FREE(doc, 'ViewPoint')]
    .filter((v) => v.hasAttribute('Guid'))
    .map((v) => ({ guid: v.getAttribute('Guid')!, viewpoint: text(v, 'Viewpoint'), snapshot: text(v, 'Snapshot') }));
  const labels = Array.from(topic.children)
    .filter((c) => c.localName === 'Labels')
    .flatMap((c) => {
      const inner = Array.from(c.children).filter((l) => l.localName === 'Label'); // BCF 3.0
      return inner.length ? inner.map((l) => l.textContent ?? '') : [c.textContent ?? ''];
    })
    .filter(Boolean);
  return {
    guid: topic.getAttribute('Guid') || folderGuid,
    title: text(topic, 'Title') ?? 'Ohne Titel',
    description: text(topic, 'Description') ?? '',
    status: topic.getAttribute('TopicStatus') ?? text(topic, 'TopicStatus'),
    priority: text(topic, 'Priority'),
    type: topic.getAttribute('TopicType') ?? text(topic, 'TopicType'),
    creationDate: text(topic, 'CreationDate'),
    creationAuthor: text(topic, 'CreationAuthor'),
    labels,
    comments,
    viewpoints,
  };
}

function vec(el: Element | undefined): Vec3 | undefined {
  if (!el) return undefined;
  const n = (k: string) => Number(text(el, k));
  const v = { x: n('X'), y: n('Y'), z: n('Z') };
  return [v.x, v.y, v.z].every(Number.isFinite) ? v : undefined;
}

export function parseViewpointCamera(xml: string): BcfCamera | undefined {
  const doc = parseXml(xml);
  const cam = NS_FREE(doc, 'PerspectiveCamera')[0];
  if (!cam) return undefined;
  const viewPoint = vec(child(cam, 'CameraViewPoint'));
  const direction = vec(child(cam, 'CameraDirection'));
  const upVector = vec(child(cam, 'CameraUpVector'));
  if (!viewPoint || !direction || !upVector) return undefined;
  const fov = Number(text(cam, 'FieldOfView'));
  return { viewPoint, direction, upVector, fieldOfView: Number.isFinite(fov) && fov > 0 ? fov : 60 };
}

export function parseProjectName(xml: string): { id?: string; name?: string } {
  const doc = parseXml(xml);
  const p = NS_FREE(doc, 'Project')[0];
  return { id: p?.getAttribute('ProjectId') ?? undefined, name: text(p, 'Name') };
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export interface MarkupInput {
  guid: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  type: string;
  creationDate: string;
  modifiedDate: string;
  author: string;
  labels: string[];
  comments: { guid: string; date: string; author: string; text: string; viewpointGuid?: string }[];
  viewpoints: { guid: string; viewpoint?: string; snapshot?: string }[];
}

export function buildMarkup(m: MarkupInput): string {
  const labels = m.labels.map((l) => `    <Labels>${esc(l)}</Labels>`).join('\n');
  const comments = m.comments
    .map(
      (c) => `  <Comment Guid="${c.guid}">
    <Date>${esc(c.date)}</Date>
    <Author>${esc(c.author)}</Author>
    <Comment>${esc(c.text)}</Comment>${c.viewpointGuid ? `\n    <Viewpoint Guid="${c.viewpointGuid}" />` : ''}
  </Comment>`,
    )
    .join('\n');
  const vps = m.viewpoints
    .map(
      (v) => `  <Viewpoints Guid="${v.guid}">${v.viewpoint ? `\n    <Viewpoint>${esc(v.viewpoint)}</Viewpoint>` : ''}${
        v.snapshot ? `\n    <Snapshot>${esc(v.snapshot)}</Snapshot>` : ''
      }
  </Viewpoints>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Markup xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Topic Guid="${m.guid}" TopicType="${esc(m.type)}" TopicStatus="${esc(m.status)}">
    <Title>${esc(m.title)}</Title>
    <Priority>${esc(m.priority)}</Priority>
${labels ? labels + '\n' : ''}    <CreationDate>${esc(m.creationDate)}</CreationDate>
    <CreationAuthor>${esc(m.author)}</CreationAuthor>
    <ModifiedDate>${esc(m.modifiedDate)}</ModifiedDate>
    <Description>${esc(m.description)}</Description>
  </Topic>
${comments ? comments + '\n' : ''}${vps ? vps + '\n' : ''}</Markup>
`;
}

const v3 = (tag: string, v: Vec3) => `    <${tag}>
      <X>${v.x}</X>
      <Y>${v.y}</Y>
      <Z>${v.z}</Z>
    </${tag}>`;

export function buildViewpoint(guid: string, cam?: BcfCamera): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<VisualizationInfo Guid="${guid}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">${
    cam
      ? `
  <PerspectiveCamera>
${v3('CameraViewPoint', cam.viewPoint)}
${v3('CameraDirection', cam.direction)}
${v3('CameraUpVector', cam.upVector)}
    <FieldOfView>${cam.fieldOfView}</FieldOfView>
  </PerspectiveCamera>`
      : ''
  }
</VisualizationInfo>
`;
}

export function buildProject(id: string, name: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ProjectExtension xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Project ProjectId="${id}">
    <Name>${esc(name)}</Name>
  </Project>
  <ExtensionSchema></ExtensionSchema>
</ProjectExtension>
`;
}

export const BCF_VERSION_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Version VersionId="2.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <DetailedVersion>2.1</DetailedVersion>
</Version>
`;
