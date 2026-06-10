'use client';
import React from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import GameCard from '@/app/_components/_sharedcomponents/Cards/GameCard';
import { CardStyle, ICardData } from '@/app/_components/_sharedcomponents/Cards/CardTypes';
import { PilePopup } from '@/app/_components/_sharedcomponents/Popup/Popup.types';
import { usePopup } from '@/app/_contexts/Popup.context';

// karabuddy: a minimal replacement for upstream's <PopupShell/> (dropped when the
// gameboard was lifted — see Gameboard.tsx). The lifted DeckDiscard / Resources
// trays already fire togglePopup('pile', …) on click for BOTH players; this is
// the renderer that was missing, so clicking a discard or resource pile shows
// the cards in it — exactly like a live karabast match.
//
// Hidden info just works: a face-down card (opponent's resources) carries no
// setId, so GameCard renders it as a card back via s3CardImageURL. We only ever
// see what the recording POV could see, so opponent resources are backs while
// their (public) discard is face-up.
export function PileViewer() {
    const { popups, closePopup } = usePopup();
    const piles = popups.filter((p): p is PilePopup => p.type === 'pile');
    if (piles.length === 0) return null;

    // Show the most-recently-opened pile; closing it reveals any earlier one.
    const top = piles[piles.length - 1];
    const closeAll = () => piles.forEach((p) => closePopup(p.uuid));

    return (
        <Box
            data-testid="pile-viewer-overlay"
            onClick={closeAll}
            sx={{
                position: 'absolute', inset: 0, zIndex: 50,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)', padding: '1rem',
            }}
        >
            <Box
                data-testid="pile-viewer"
                onClick={(e) => e.stopPropagation()}
                sx={{
                    background: '#11141a', border: '1px solid #2e333c', borderRadius: '12px',
                    boxShadow: '0 12px 40px rgba(0,0,0,0.6)', maxWidth: 'min(920px, 92vw)',
                    width: '100%', maxHeight: '82vh', display: 'flex', flexDirection: 'column',
                    padding: '1rem 1.1rem',
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                    <Typography sx={{ fontFamily: 'var(--font-barlow), sans-serif', fontWeight: 700, fontSize: '1.05rem', color: '#e6e6e6' }}>
                        {top.title}
                        <Typography component="span" sx={{ ml: '0.5rem', fontSize: '0.85rem', fontWeight: 600, color: '#6c7588' }}>
                            {top.cards.length}
                        </Typography>
                    </Typography>
                    <IconButton aria-label="Close" onClick={closeAll} sx={{ color: '#a0a8b8', fontSize: '1.1rem', lineHeight: 1 }}>✕</IconButton>
                </Box>

                {top.cards.length === 0 ? (
                    <Typography sx={{ color: '#a0a8b8', fontSize: '0.9rem', padding: '1.5rem 0', textAlign: 'center' }}>
                        No cards in this pile.
                    </Typography>
                ) : (
                    <Box
                        sx={{
                            marginTop: '0.9rem', overflowY: 'auto',
                            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
                            gap: '10px', padding: '6px', justifyContent: 'center',
                        }}
                    >
                        {top.cards.map((card: ICardData, i: number) => (
                            <Box key={card.uuid ?? i}>
                                <GameCard card={card} cardStyle={CardStyle.Plain} disabled />
                            </Box>
                        ))}
                    </Box>
                )}
            </Box>
        </Box>
    );
}

export default PileViewer;
