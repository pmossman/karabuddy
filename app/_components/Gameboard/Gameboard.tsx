// Adapted from forceteki-client/src/app/GameBoard/page.tsx (MIT, Dan Bastin).
// See ./ATTRIBUTION.md.
// Surgery for karabuddy:
//  - Dropped <ChatDrawer/>, <PopupShell/>, <PreferencesComponent/>, and the
//    central prompt <RichText/>. Each pulls in features (sockets, popups,
//    prefs UI) that we intentionally left out for the read-only viewer.
//  - Removed lobby-redirect + win-screen useEffects (no /lobby route here).
//  - Removed the early-return when there's no gameState so the empty shell
//    still mounts at /test-board for verification.
//  - Background falls back to a plain dark color when the cosmetics stub
//    returns no path.
/* eslint-disable @typescript-eslint/no-unused-vars */
'use client';
import React, { useState } from 'react';
import { Box, Grid2 as Grid } from '@mui/material';
import OpponentCardTray from './OpponentCardTray/OpponentCardTray';
import Board from './Board/Board';
import PlayerCardTray from './PlayerCardTray/PlayerCardTray';
import { useGame } from '@/app/_contexts/Game.context';
import { useCosmetics } from '@/app/_contexts/CosmeticsContext';

const Gameboard: React.FC = () => {
    const { getOpponent, connectedPlayer, gameState, isSpectator } = useGame();
    const { getBackground } = useCosmetics();
    // localStorage is unavailable during SSR; default true and skip the read.
    const [sidebarOpen, setSidebarOpen] = useState(true);

    const user = gameState?.players?.[connectedPlayer]?.user;
    const background = getBackground(isSpectator ? null : user?.cosmetics?.background ?? null);
    const backgroundUrl = background?.path ? `url(${background.path}?v=2)` : undefined;

    const toggleSidebar = () => setSidebarOpen((open) => !open);
    const handlePreferenceToggle = () => { /* TODO(karabuddy): wire prefs panel */ };

    const styles = {
        mainBoxStyle: {
            pr: sidebarOpen ? 'min(20%, 280px)' : '0',
            width: '100%',
            transition: 'padding-right 0.3s ease-in-out',
            // Subtract the persistent (app) layout header height so the
            // bottom player tray isn't clipped. `--kb-header-h` is set in
            // app/globals.css; defaults to 0 if absent. See B1.
            height: 'calc(100dvh - var(--kb-header-h, 0px))',
            position: 'relative',
            backgroundImage: backgroundUrl,
            backgroundColor: '#0b0b12',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            display: 'flex',
            flexDirection: 'column',
        },
    } as const;

    // Render the empty shell even when gameState isn't loaded — gives the
    // /test-board route something to confirm the component tree mounts.
    const playerExists = !!gameState && !!connectedPlayer && (
        (gameState.players && connectedPlayer in gameState.players) ||
        (gameState.spectators && connectedPlayer in gameState.spectators)
    );

    return (
        <Grid container sx={{ height: 'calc(100dvh - var(--kb-header-h, 0px))', overflow: 'hidden' }}>
            <Box component="main" sx={styles.mainBoxStyle} data-testid="gameboard-main-box">
                {/* Row heights are percentages of the parent (was 15/67/18 dvh)
                    so the tray-board-tray stack fits inside the header-aware
                    container instead of overflowing by --kb-header-h. */}
                <Box sx={{ height: '15%' }}>
                    {playerExists && (
                        <OpponentCardTray
                            trayPlayer={getOpponent(connectedPlayer)}
                            preferenceToggle={handlePreferenceToggle}
                        />
                    )}
                </Box>
                <Box sx={{ height: '67%', position: 'relative', zIndex: 2 }}>
                    {playerExists && <Board sidebarOpen={sidebarOpen} />}
                </Box>
                <Box sx={{ height: '18%' }}>
                    {playerExists && (
                        <PlayerCardTray
                            trayPlayer={connectedPlayer}
                            toggleSidebar={toggleSidebar}
                        />
                    )}
                </Box>
            </Box>
        </Grid>
    );
};

export default Gameboard;
