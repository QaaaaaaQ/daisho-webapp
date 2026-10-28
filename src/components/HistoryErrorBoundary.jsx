import { Component } from 'react';

// Keep the application's navigation available after an unforeseen display error.
export default class HistoryErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() {
    console.error('HistoryView rendering failed');
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <section role="alert" style={{padding:24,color:'#991b1b'}}>
      <h3>{'\u767a\u884c\u5c65\u6b74\u306e\u8868\u793a\u4e2d\u306b\u30a8\u30e9\u30fc\u304c\u767a\u751f\u3057\u307e\u3057\u305f'}</h3>
      <p>{'\u66f8\u985e\u30fb\u5728\u5eab\u30c7\u30fc\u30bf\u306f\u5909\u66f4\u3057\u3066\u3044\u307e\u305b\u3093\u3002'}</p>
      <button onClick={()=>this.setState({failed:false})}>{'\u518d\u8868\u793a'}</button>{' '}
      <button onClick={this.props.onHome}>{'\u4eca\u65e5\u306e\u696d\u52d9\u3078\u623b\u308b'}</button>
    </section>;
  }
}
