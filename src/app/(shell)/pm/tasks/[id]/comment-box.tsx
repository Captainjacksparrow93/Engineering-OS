'use client';

import { useActionState } from 'react';
import { addCommentAction, type ActionState } from '@/app/actions/pm';
import { FormMessage, SubmitButton } from '@/components/form';
import { Avatar } from '@/components/ui';

interface Comment {
  id: string;
  body: string;
  createdAt: Date;
  user: { id: string; fullName: string; avatarColor: string };
}

export function CommentBox({ taskId, comments }: { taskId: string; comments: Comment[] }) {
  const [state, action] = useActionState<ActionState, FormData>(addCommentAction, {});

  return (
    <section className="card">
      <header className="card-header">
        <h2 className="card-title">Discussion</h2>
      </header>
      <div className="card-body">
        <form action={action}>
          <input type="hidden" name="taskId" value={taskId} />
          <textarea name="body" rows={2} required className="textarea" placeholder="Ask a question or add context…" />
          <FormMessage state={state} />
          <div className="mt-2">
            <SubmitButton size="sm">Post</SubmitButton>
          </div>
        </form>

        {comments.length > 0 ? (
          <ul className="mt-4 space-y-3 border-t border-hairline pt-3">
            {comments.map((comment) => (
              <li key={comment.id} className="flex gap-2">
                <Avatar name={comment.user.fullName} color={comment.user.avatarColor} size={24} />
                <div className="min-w-0">
                  <p className="text-caption font-medium text-ink">{comment.user.fullName}</p>
                  <p className="whitespace-pre-wrap text-body-sm text-body">{comment.body}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
