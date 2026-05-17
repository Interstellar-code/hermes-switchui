export type TaskBoardStatus = 'todo' | 'in_progress' | 'blocked' | 'review' | 'done'
export type TaskBoardCard = { id: string; title: string; status?: TaskBoardStatus; [key: string]: unknown }
