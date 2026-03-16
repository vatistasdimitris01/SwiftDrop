import * as React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    // @ts-ignore
    this.state = {
      hasError: false,
      error: null
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    // @ts-ignore
    const { hasError, error } = this.state;
    if (hasError) {
      return (
        <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center font-sans">
          <h1 className="text-4xl font-bold tracking-tighter uppercase mb-4">Something went wrong.</h1>
          <p className="text-sm opacity-50 uppercase tracking-widest mb-8 max-w-md">
            An unexpected error occurred. Please try refreshing the page.
          </p>
          <div className="p-4 border border-black bg-black text-white text-xs font-mono max-w-full overflow-auto text-left">
            {error?.message}
          </div>
          <button 
            onClick={() => window.location.reload()}
            className="mt-8 px-8 py-4 bg-black text-white font-bold uppercase tracking-widest hover:bg-neutral-800"
          >
            Refresh Page
          </button>
        </div>
      );
    }

    // @ts-ignore
    return this.props.children;
  }
}
