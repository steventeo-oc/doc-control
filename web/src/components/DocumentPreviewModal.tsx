import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Maximize2,
  Minimize2,
  RefreshCw,
  X,
} from 'lucide-react';
import { downloadFile } from '../api/client';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

interface DocumentPreviewViewerProps {
  documentId: number;
  versionId: number;
  documentNumber: string;
  versionNumber?: number;
  title?: string;
  className?: string;
  height?: string;
  showToolbar?: boolean;
}

export function DocumentPreviewViewer({
  documentId,
  versionId,
  documentNumber,
  versionNumber,
  title,
  className,
  height = '600px',
  showToolbar = true,
}: DocumentPreviewViewerProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [isPdf, setIsPdf] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const previewEndpoint = `/api/documents/${documentId}/versions/${versionId}/download?inline=true`;
  const downloadEndpoint = `/documents/${documentId}/versions/${versionId}/download`;

  useEffect(() => {
    let active = true;
    let url: string | null = null;
    setLoading(true);
    setError(null);
    setIsPdf(true);

    fetch(previewEndpoint, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(text || `Failed to load document preview (HTTP ${res.status})`);
        }
        return res.blob();
      })
      .then(async (blob) => {
        if (!active) return;
        // Verify genuine PDF header (%PDF-)
        const slice = await blob.slice(0, 5).arrayBuffer();
        const header = new TextDecoder().decode(slice);
        const validPdf = header.startsWith('%PDF');

        if (!validPdf) {
          setIsPdf(false);
          setLoading(false);
          return;
        }

        setIsPdf(true);
        const pdfBlob = new Blob([blob], { type: 'application/pdf' });
        url = URL.createObjectURL(pdfBlob);
        setBlobUrl(url);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (!active) return;
        setError(err.message || 'Could not load document preview.');
        setLoading(false);
      });

    return () => {
      active = false;
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [documentId, versionId, previewEndpoint, reloadKey]);

  return (
    <div
      className={cn(
        'flex flex-col rounded-xl border border-border/40 bg-card overflow-hidden',
        'shadow-[0_2px_10px_-3px_rgba(0,0,0,0.05),0_1px_3px_-1px_rgba(0,0,0,0.03)] dark:shadow-[0_2px_10px_-3px_rgba(0,0,0,0.3)]',
        'ring-1 ring-black/[0.03] dark:ring-white/[0.04]',
        className
      )}
    >
      {showToolbar && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-muted/20 border-b border-border/30 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="size-4 text-primary shrink-0" />
            <span className="font-semibold truncate">
              {documentNumber}
              {versionNumber !== undefined && ` Rev ${versionNumber}`}
            </span>
            {title && (
              <span className="text-muted-foreground truncate hidden sm:inline">
                — {title}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
              disabled={!isPdf || !blobUrl}
              onClick={() => {
                if (blobUrl) {
                  window.open(blobUrl, '_blank');
                } else {
                  window.open(previewEndpoint, '_blank');
                }
              }}
              title="Open preview in a new browser tab"
            >
              <ExternalLink className="size-3" />
              <span>New tab</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1 border-border/40 hover:bg-muted/40"
              onClick={() => downloadFile(downloadEndpoint)}
              title="Download stamped controlled document"
            >
              <Download className="size-3" />
              <span>Download</span>
            </Button>
          </div>
        </div>
      )}

      <div className="relative w-full bg-slate-100/40 dark:bg-muted/15 p-1.5 sm:p-2" style={{ height }}>
        {loading && (
          <div className="absolute inset-2 sm:inset-3 flex flex-col items-center justify-center gap-2.5 bg-background/95 rounded-lg border border-border/30 z-10">
            <div className="size-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-muted-foreground font-medium">Rendering document preview…</span>
          </div>
        )}

        {error ? (
          <div className="absolute inset-2 sm:inset-3 flex flex-col items-center justify-center gap-3 p-6 text-center bg-background/90 rounded-lg border border-border/30 z-10">
            <div className="p-2.5 rounded-full bg-destructive/10 text-destructive">
              <AlertCircle className="size-6" />
            </div>
            <div className="max-w-md">
              <p className="text-sm font-semibold text-foreground">Unable to preview document</p>
              <p className="text-xs text-muted-foreground mt-1">{error}</p>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1 text-xs border-border/40"
                onClick={() => setReloadKey((k) => k + 1)}
              >
                <RefreshCw className="size-3.5" />
                Retry
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                className="gap-1 text-xs"
                onClick={() => downloadFile(downloadEndpoint)}
              >
                <Download className="size-3.5" />
                Download file
              </Button>
            </div>
          </div>
        ) : !isPdf ? (
          <div className="absolute inset-2 sm:inset-3 flex flex-col items-center justify-center gap-3 p-6 text-center bg-background/95 rounded-lg border border-border/30 z-10">
            <div className="p-2.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <FileText className="size-6" />
            </div>
            <div className="max-w-md">
              <p className="text-sm font-semibold text-foreground">In-Browser Preview Not Available</p>
              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                This document revision is stored in a format that cannot be directly previewed in the browser. In-browser preview is supported for PDF, Word, Excel, PowerPoint, and text files. Please download the file to inspect its contents.
              </p>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <Button
                type="button"
                variant="default"
                size="sm"
                className="gap-1.5 text-xs shadow-xs"
                onClick={() => downloadFile(downloadEndpoint)}
              >
                <Download className="size-3.5" />
                Download file to view
              </Button>
            </div>
          </div>
        ) : blobUrl ? (
          <iframe
            src={blobUrl}
            className="w-full h-full rounded-lg border border-border/30 bg-background shadow-xs"
            title={`Document Preview ${documentNumber}`}
          />
        ) : null}
      </div>
    </div>
  );
}

interface DocumentPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: number;
  versionId?: number | null;
  documentNumber: string;
  versionNumber?: number;
  title?: string;
}

export default function DocumentPreviewModal({
  open,
  onOpenChange,
  documentId,
  versionId,
  documentNumber,
  versionNumber,
  title,
}: DocumentPreviewModalProps) {
  const [maximized, setMaximized] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [isPdf, setIsPdf] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const previewEndpoint = versionId
    ? `/api/documents/${documentId}/versions/${versionId}/download?inline=true`
    : '';
  const downloadEndpoint = versionId
    ? `/documents/${documentId}/versions/${versionId}/download`
    : '';

  useEffect(() => {
    if (!open || !versionId) return;

    let active = true;
    let url: string | null = null;
    setLoading(true);
    setError(null);
    setIsPdf(true);

    fetch(previewEndpoint, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(text || `Failed to load document preview (HTTP ${res.status})`);
        }
        return res.blob();
      })
      .then(async (blob) => {
        if (!active) return;
        // Verify genuine PDF header (%PDF-)
        const slice = await blob.slice(0, 5).arrayBuffer();
        const header = new TextDecoder().decode(slice);
        const validPdf = header.startsWith('%PDF');

        if (!validPdf) {
          setIsPdf(false);
          setLoading(false);
          return;
        }

        setIsPdf(true);
        const pdfBlob = new Blob([blob], { type: 'application/pdf' });
        url = URL.createObjectURL(pdfBlob);
        setBlobUrl(url);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (!active) return;
        setError(err.message || 'Could not load document preview.');
        setLoading(false);
      });

    return () => {
      active = false;
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [open, documentId, versionId, previewEndpoint, reloadKey]);

  if (!open || !versionId) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          'p-0 gap-0 transition-all duration-200 overflow-hidden flex flex-col',
          'border border-border/40 shadow-2xl shadow-black/10 dark:shadow-black/40 ring-1 ring-black/[0.03] dark:ring-white/[0.04]',
          maximized
            ? '!max-w-[98vw] !w-[98vw] !h-[96vh] rounded-xl'
            : 'sm:max-w-4xl w-[90vw] h-[85vh] rounded-2xl'
        )}
      >
        <DialogHeader className="px-5 py-3 border-b border-border/30 bg-muted/20 flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2.5 min-w-0 pr-6">
            <div className="p-1.5 rounded-md bg-primary/10 text-primary shrink-0">
              <Eye className="size-4" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-sm font-semibold flex items-center gap-2 truncate">
                <span>{documentNumber}</span>
                {versionNumber !== undefined && (
                  <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground border border-border/30">
                    Rev {versionNumber}
                  </span>
                )}
              </DialogTitle>
              {title && (
                <p className="text-xs text-muted-foreground truncate">{title}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
              disabled={!isPdf || !blobUrl}
              onClick={() => {
                if (blobUrl) {
                  window.open(blobUrl, '_blank');
                } else {
                  window.open(previewEndpoint, '_blank');
                }
              }}
              title="Open full document in new browser tab"
            >
              <ExternalLink className="size-3.5" />
              <span className="hidden sm:inline">New tab</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-2.5 text-xs gap-1 border-border/40 hover:bg-muted/40"
              onClick={() => downloadFile(downloadEndpoint)}
              title="Download stamped copy"
            >
              <Download className="size-3.5" />
              <span className="hidden sm:inline">Download</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => setMaximized(!maximized)}
              title={maximized ? 'Restore size' : 'Maximize window'}
            >
              {maximized ? (
                <Minimize2 className="size-4" />
              ) : (
                <Maximize2 className="size-4" />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => onOpenChange(false)}
            >
              <X className="size-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 w-full bg-slate-100/40 dark:bg-muted/15 p-2 sm:p-3 relative overflow-hidden flex flex-col">
          {loading && (
            <div className="absolute inset-2 sm:inset-3 flex flex-col items-center justify-center gap-2.5 bg-background/95 rounded-xl border border-border/30 z-10">
              <div className="size-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-muted-foreground font-medium">Loading document preview…</span>
            </div>
          )}

          {error ? (
            <div className="absolute inset-2 sm:inset-3 flex flex-col items-center justify-center gap-3 p-6 text-center bg-background/90 rounded-xl border border-border/30 z-10">
              <div className="p-2.5 rounded-full bg-destructive/10 text-destructive">
                <AlertCircle className="size-6" />
              </div>
              <div className="max-w-md">
                <p className="text-sm font-semibold text-foreground">Unable to preview document</p>
                <p className="text-xs text-muted-foreground mt-1">{error}</p>
              </div>
              <div className="flex items-center gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1 text-xs border-border/40"
                  onClick={() => setReloadKey((k) => k + 1)}
                >
                  <RefreshCw className="size-3.5" />
                  Retry
                </Button>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  className="gap-1 text-xs"
                  onClick={() => downloadFile(downloadEndpoint)}
                >
                  <Download className="size-3.5" />
                  Download file
                </Button>
              </div>
            </div>
          ) : !isPdf ? (
            <div className="absolute inset-2 sm:inset-3 flex flex-col items-center justify-center gap-3 p-6 text-center bg-background/95 rounded-xl border border-border/30 z-10">
              <div className="p-3 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <FileText className="size-7" />
              </div>
              <div className="max-w-md">
                <p className="text-sm font-semibold text-foreground">In-Browser Preview Not Available</p>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                  This document revision ({documentNumber}{versionNumber !== undefined ? ` Rev ${versionNumber}` : ''}) is stored as a controlled file attachment. In-browser preview is supported for PDF, Word, Excel, PowerPoint, and text files. Please download the file to inspect its contents.
                </p>
              </div>
              <div className="flex items-center gap-2 pt-2">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  className="gap-1.5 text-xs shadow-xs"
                  onClick={() => downloadFile(downloadEndpoint)}
                >
                  <Download className="size-3.5" />
                  Download file to view
                </Button>
              </div>
            </div>
          ) : blobUrl ? (
            <iframe
              src={blobUrl}
              className="w-full h-full border border-border/30 rounded-xl bg-background shadow-xs"
              title={`Preview of ${documentNumber}`}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
