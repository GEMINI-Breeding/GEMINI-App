import React from 'react';

const DocsFrame = () => {
    return (
        <div style={{ width: '100%', height: '100vh', overflow: 'hidden' }}>
            <iframe
                src="https://gemini-breeding.github.io/"
                title="GEMINI Documentation"
                style={{ width: '100%', height: '100%', border: 'none' }}
            />
        </div>
    );
};

export default DocsFrame;
