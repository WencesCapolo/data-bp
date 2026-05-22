'use client';
import { Component, type ReactNode } from 'react';
import { ErrorBox } from './ErrorBox';

type Props = { children: ReactNode };
type State = { error: Error | null };

export class TabBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Tab render error:', error);
  }

  render() {
    if (this.state.error) {
      return <ErrorBox message={this.state.error.message} />;
    }
    return this.props.children;
  }
}
