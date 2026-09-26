/** Video domain: the video-recap studio. */
import { VideoStudio } from '../video-studio.js'
import type { StudioDomain, StudioProps } from './types.ts'

function VideoWorkbench({ t, sessionId, workspace, building, hidden, workbenches, onWorkbench, useStore, actions }: StudioProps) {
  const videoTab = useStore(memory => memory.videoTab)
  const videoProjectId = useStore(memory => memory.videoProjectId)
  return <VideoStudio
    t={t}
    sessionId={sessionId}
    projects={workspace.videos}
    running={building}
    projectId={videoProjectId}
    tab={videoTab}
    hidden={hidden}
    workbenches={workbenches}
    onProject={actions.setVideoProjectId}
    onTab={actions.setVideoTab}
    onWorkbench={onWorkbench}
  />
}

/** The video-recap workbench domain. */
export const videoDomain: StudioDomain<'video'> = {
  mode: 'video',
  surface: 'studio',
  groupOrder: ['video-recaps'],
  activityRoot: 'video-recaps/',
  connectingKey: 'video.connecting',
  Placeholder: ({ children }) => <main className="oh-video-studio"><div className="oh-video-preview-empty">{children}</div></main>,
  Studio: VideoWorkbench,
  enter: (actions) => { actions.setVideoTab('preview') },
  holdsAgentFollow: memory => memory.videoTab === 'preview',
}
