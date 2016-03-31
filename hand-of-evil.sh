#!/usr/bin/env bash

DIR="$(dirname "$(realpath "$0")")"
ARCHIVE=HandOfEvil.zip
TMP="${DIR}/tmp.png"
TMP="${DIR}/tmp.png"
MAPPING_CONF='mapping.conf'
FIELDS=(name hot_point prefix frame)
MESSAGES=(
    [0]='There must be at least one Xcursor name'
    [1]='Missing colon-separated hot point coordinates'
    [2]='Missing file name prefix'
    [3]='There must be at least one frame'
    [100]='Invalid frame format'
    [101]='No such image'
)
ERRORS=0
LINE=1
FILE_NAME='%s%s'
FILE_MASK='%s%s'

function error() {
    echo "LINE $LINE: $1"
    let ERRORS++
}

function process() {
    tmp=$(printf "${DIR}/tmp%04d.png" "${index}")
    d=($(convert "${file}" -print '%W %H ' "${rotate_arg[@]}" "${do_args[@]}" "${effect_args[@]}" -trim -print '%X %Y %w %h %W %H' "${tmp}" 2>&1))
    if [ -n "${rotate_arg}" ]; then
        hot_point=($(echo "${hot_point[@]} ${ANGLE} ${d[@]:0:2} ${d[@]:6:2}"|awk '{xd=$1-($4-1)/2; yd=$2-($5-1)/2; a=$3*atan2(0,-1)/180; c=cos(a); s=sin(a); printf("%.0f %.0f", ($6-1)/2+xd*c-yd*s, ($7-1)/2+yd*c+xd*s)}'))
    fi
    for i in 0 1; do
        let hot_point[i]-=d[i+2]
    done
    unset extent
    for i in 0 1; do
        if (( hot_point[i] < 0 )); then
            let d[i+4]-=hot_point[i]
            hot_point[i]=0
            extent=true
        fi
    done
    if [ -n extent ]; then
        mogrify -background none -gravity SouthEast -extent "${d[4]}x${d[5]}" "${tmp}"
    fi
    size=$(( d[4] > d[5] ? d[4] : d[5] ))
    echo "${size} ${hot_point[0]} ${hot_point[1]} ${tmp}"
}

function conf() {
    unset delay processed config
    if [ -n "${DO}" ]; then
        readarray -t do_args < <( echo ${DO[@]}|xargs -n 1 echo )
    else
        do_args=()
    fi
    if [ -n "${ANGLE}" ]; then
        rotate_arg=( -background none -rotate "${ANGLE}" +repage)
    else
        rotate_arg=()
    fi
    if [ -n "${EFFECT}" ]; then
        readarray -t effect_args < <( echo ${EFFECT[@]}|xargs -n 1 echo )
    else
        effect_args=()
    fi
    index=1
    max_size=0
    declare -A processed
    for ((f = 1; f <= $#; f++)); do
        if [[ ! "${!f}" =~ ^(\*|[0-9]+)(:([0-9]+))?$ ]]; then return 100; fi
        if [ -n "${BASH_REMATCH[3]}" ]; then delay="${BASH_REMATCH[3]}"; fi
        suffix="${BASH_REMATCH[1]}"
        if [ "${suffix}" = '*' ]; then
            files=("$(printf "../../${FILE_MASK}" "${prefix}" '*')")
        else
            files=("$(printf "../../${FILE_NAME}" "${prefix}" "${suffix}")")
        fi
        for file in ${files[@]}; do
            if [ -n "${processed["$file"]}" ]; then
                if [ "${suffix}" != '*' ]; then
                    config+=("${processed["$file"]} ${delay}")
                fi
                continue
            fi
            line=($(process))
            size="${line[0]}"
            if (( max_size < size )); then
                let max_size=size
            fi
            line="${line[@]:1}"
            config+=("${line} ${delay}")
            processed["${file}"]="${line}"
            let index++
        done
    done
    for ((f = 0; f < "${#config[@]}"; f++)); do
        echo ${max_size} "${config[f]}"
    done
}

function map() {
    unset name hot_point prefix frame
    if [[ $# -eq 0 || $1 =~ ^#.* ]]; then return; fi
    case $1 in
        '!file-name') FILE_NAME="$2"; return ;;
        '!file-mask') FILE_MASK="$2"; return ;;
        '!do') DO=("${@:2}"); return ;;
        '!rotate') ANGLE="$2"; return ;;
        '!effect') EFFECT=("${@:2}"); return ;;
        '!alias') ln -sf "$3" "../../$2"; return ;;
        !*) error "Unknown option: ${1}"; return ;;
    esac
    for ((i = 1; i <= $#; i++)); do
        if [[ -z "${hot_point}" && "${!i}" =~ ^([0-9]+):([0-9]+)$ ]]; then
            hot_point=("${BASH_REMATCH[@]:1:2}")
        elif [[ "${!i}" =~ (/|^\.\.?$) ]]; then
            error "'${!i}' is invalid file name"; return
        elif [ -n "${hot_point}" ]; then
            prefix="${!i}"
            if [ "$i" -lt $# ]; then frame=true; fi
            break
        elif [ "$i" -eq 1 ]; then
            name="${!i}"
        else
            ln -sf "${name}" "${!i}"
        fi
    done
    for ((k = 0; k < ${#FIELDS[@]}; k++)); do
        key="${FIELDS[k]}"
        if [ -z "$(eval echo \$${key})" ]; then
            error "${MESSAGES[k]}"; return
        fi
    done
    config="$(conf "${@:i+1}")"
    code=$?
    if [ ${code} -eq 0 ]; then
        echo "${config}"|xcursorgen - "${name}"
        unset DO ANGLE
    else
        error "${MESSAGES[code]}"
    fi
}

# Download and unpack archive with images
CURSORS="${DIR}/hand-of-evil/cursors"
rm -r "${CURSORS}"
mkdir -p "${CURSORS}"
cd "${DIR}"
if [ ! -f "${ARCHIVE}" ]; then
    wget -q -O "${ARCHIVE}" --show-progress 'ftp://ftp.ea-europe.com/support/patches/dk2/HandOfEvil.zip'
    if [ $? != 0 ]; then
        echo "ERROR: Failed to download ${ARCHIVE} archive"
        exit -1
    fi
fi
if [ $(md5sum "${ARCHIVE}"|cut -d' ' -f1) != 'c1dd086f15a91bfa08c30530d0ff1e6f' ]; then
    echo "ERROR: ${ARCHIVE} archive checksum mismatch"
    exit -2
fi
unzip -q -o "${ARCHIVE}"

# Prepare layout and create index file
cd hand-of-evil
echo "[Icon Theme]" > index.theme
echo "Name=Hand of Evil" >> index.theme
echo "Inherits=dummy-theme" >> index.theme
cd cursors

while read -ra words || [ -n "${words}" ]; do
    map "${words[@]}"
    let LINE++
done < "${DIR}/${MAPPING_CONF}"

if [ "${ERRORS}" -gt 0 ]; then
    echo
    echo "${ERRORS} errors occurred during parsing ${MAPPING_CONF} file."
    echo "Please make sure that all the mentioned lines conform to the following format:"
    echo
    echo "name1 [name2, ...] x:y prefix frame1 [frame2, ...]"
    echo
fi

# Build archive
cd "${DIR}"
tar czf hand-of-evil.tar.gz hand-of-evil

echo "
GENERATION COMPLETED

You can now install the theme with one of the following ways:
1. Using GUI, i.e. in KDE choose \"cursor theme\" from menu and install from:
   ${DIR}/hand-of-evil.tar.gz
2. Manual way is to do:
   sudo mv ${DIR}/hand-of-evil /usr/share/icons
   sudo update-alternatives --install /usr/share/icons/default/index.theme x-cursor-theme /usr/share/icons/hand-of-evil/index.theme 200"

# Remove images
rm *.png