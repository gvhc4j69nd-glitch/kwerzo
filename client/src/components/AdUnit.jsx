import { useEffect, useRef, useState } from 'react';

export default function AdUnit({ style }) {
  const ref = useRef(null);
  const [adFilled, setAdFilled] = useState(false);

  useEffect(() => {
    try {
      if (ref.current && ref.current.offsetWidth > 0) {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      }
    } catch (_) {}

    // Check after a short delay if AdSense filled the slot
    const t = setTimeout(() => {
      const ins = ref.current?.querySelector('ins.adsbygoogle');
      if (ins && ins.getAttribute('data-ad-status') === 'filled') {
        setAdFilled(true);
      }
    }, 1500);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      ref={ref}
      style={{
        textAlign: 'center',
        margin: '16px 0',
        minHeight: adFilled ? undefined : 90,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: adFilled ? 'none' : '1px dashed rgba(255,255,255,0.12)',
        borderRadius: 8,
        background: adFilled ? 'transparent' : 'rgba(255,255,255,0.03)',
        color: 'rgba(255,255,255,0.25)',
        fontSize: 11,
        ...style,
      }}
    >
      {!adFilled && <span style={{ pointerEvents: 'none', userSelect: 'none' }}>Advertisement</span>}
      <ins
        className="adsbygoogle"
        style={{ display: 'block', width: '100%' }}
        data-ad-client="ca-pub-3107493448711439"
        data-ad-slot="auto"
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}
