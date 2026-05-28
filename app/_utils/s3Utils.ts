import {
    ICardData,
    IServerCardData,
    ISetCode,
    CardStyle,
    IPreviewCard,
    LeaderBaseCardStyle
} from '../_components/_sharedcomponents/Cards/CardTypes';
import {
    isGameCard,
    isPreviewCard,
    isSetCodeCard,
    parseSetId
} from '@/app/_components/_sharedcomponents/Cards/cardUtils';
import { HIDDEN_SET } from '@/lib/replayDecoder';

export const s3ImageURL = (path: string) => {
    const s3Bucket = 'https://karabast-data.s3.amazonaws.com/';
    return s3Bucket + path;
};

export function s3CardImageURL(
    card: ICardData | ISetCode | IServerCardData | IPreviewCard,
    cardStyle: CardStyle | LeaderBaseCardStyle = CardStyle.Plain,
    cardback?: string,
): string {
    const isGameOrSetCard = isGameCard(card) || isSetCodeCard(card) || isPreviewCard(card);
    if ((isGameOrSetCard && !card?.setId) && !card?.id) {
        return cardback ? cardback : s3ImageURL('game/swu-cardback.webp');
    }
    // karabuddy: opponent-hand stubs get tagged with the HIDDEN_SET sentinel
    // by lib/replayDecoder.ts so they survive type checks. There's no real S3
    // art for that pseudo-set, so render the cardback the same as an empty stub.
    const sentinelSet = isGameOrSetCard
        ? card?.setId?.set
        : (card?.id ? parseSetId(card.id).set : undefined);
    if (sentinelSet === HIDDEN_SET) {
        return cardback ? cardback : s3ImageURL('game/swu-cardback.webp');
    }
    const setId = isGameOrSetCard ? card.setId : parseSetId(card.id);
    // check if the card has a type
    let cardType: string | undefined;
    if ('type' in card && card.type) {
        cardType = card.type;
    } else if ('types' in card && card.types != null) {
        cardType = Array.isArray(card.types) ? card.types.join() : card.types;
    }
    const format = cardStyle === CardStyle.InPlay ? 'truncated' : 'standard';

    const tokenIds = ['3941784506', '3463348370', '7268926664', '9415311381', '8752877738', '2007868442', '6665455613']
    if (cardType?.includes('token') || (card.id && tokenIds.includes(card.id))) {
        // Tokens live at cards/_tokens/<format>/... with no locale segment
        // (no localized art for token cards).
        return s3ImageURL(`cards/_tokens/${format}/${card.id}.webp`);
    }

    let cardNumber = setId.number.toString().padStart(3, '0')

    if ((isGameCard(card) && cardType === 'leader' && (card.zone === 'base')) ||
        (cardStyle === CardStyle.PlainLeader)) {
        cardNumber += '-base';
    }
    if (cardType === 'leader' && 'onStartingSide' in card && !card.onStartingSide) {
        cardNumber += '2';
    }

    // Path shape: cards/<SET>/en/<format>/large/<N>.webp. Newer sets
    // (ASH onward) are only mirrored under the `en/` locale segment, and
    // older sets are served at both paths, so the locale-prefixed form is
    // safe for everything.
    return s3ImageURL(`cards/${setId.set}/en/${format}/large/${cardNumber}.webp?v=3`);
};



export const s3TokenImageURL = (token_name: string) =>{
    return s3ImageURL(`game/${token_name}.webp`);
}