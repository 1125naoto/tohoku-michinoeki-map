interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  /** キャンセル側ボタンの文言（既定は「キャンセル」） */
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({ title, message, confirmLabel, cancelLabel, danger, onConfirm, onCancel }: Props) {
  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="dialog">
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="actions">
          <button onClick={onCancel} data-testid="confirm-cancel">
            {cancelLabel ?? 'キャンセル'}
          </button>
          <button
            className={danger ? 'btn-danger-ghost' : 'btn-primary'}
            onClick={onConfirm}
            data-testid="confirm-ok"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
