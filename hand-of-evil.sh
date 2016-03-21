#!/usr/bin/env bash

tmp=/tmp/hand-of-evil/hnd_tmp.png

##03b6e0fcb3499374a867c041f52298f0 dnd-no-drop

function prepare() {
    s=(999 999 0 0)
    for file in ../../hnd_$1*.png; do
        d=(`convert ${file} -trim -print '%X %Y %w %h' ${tmp}`)
        for i in 0 1; do
            j=$((i + 2))
            let d[j]+=d[i]
            if (( d[i] < s[i] )); then s[i]=${d[i]}; fi
            if (( d[j] > s[j] )); then s[j]=${d[j]}; fi
        done
    done

    for i in 0 1; do let s[i+2]-=s[i]; done

    delays=(${@:4})
    files=(../../hnd_$1*.png)
    for (( i=0; i<${#files[@]}; i++ )); do
        file=${files[i]}
        if (( delays[i] != 0 )); then delay=${delays[i]}; fi
        mogrify -crop ${s[2]}x${s[3]}+${s[0]}+${s[1]} ${file}
        echo ${s[0]} $2 $3 ${file} ${delay}
    done
}

function series() {
    prepare $4 $2 $3 "${@:5}"|xcursorgen - $1
}

function single() {
    file=../../hnd_$4.png
    echo "`mogrify -trim -print '%[fx:max(w,h)]' ${file}` $2 $3 ${file}"|xcursorgen - $1
}

function rotated() {
    convert -background none -rotate $5 ../../hnd_$4.png ${tmp}
    single $1 $2 $3 tmp
}

function reorder() {
    rm  ../../hnd_reordered*>/dev/null
    n=10
    for i in "${@:2}"; do
        cp ../../hnd_${1}00${i}.png ../../hnd_reordered${n}.png
        let "n++"
    done
}

# Download and unpack archive with images
mkdir -p /tmp/hand-of-evil/hand-of-evil/cursors
cd /tmp/hand-of-evil
#wget ftp://ftp.ea-europe.com/support/patches/dk2/HandOfEvil.zip
if [ `md5sum HandOfEvil.zip|cut -d' ' -f1` != 'c1dd086f15a91bfa08c30530d0ff1e6f' ]; then
    echo "Failed to download HandOfEvil.zip archive"
    exit -1
fi
unzip -q -o HandOfEvil.zip

# Prepare layout and create index file
cd hand-of-evil
echo "[Icon Theme]" > index.theme
echo "Name=Hand of Evil" >> index.theme
echo "Inherits=dummy-theme" >> index.theme
cd cursors

# Some image modifications
mogrify -draw 'point 30,32 point 31,31 point 32,32 point 31,33' ../../hnd_possess.png
cp ../../hnd_holdcreature0042.png ../../hnd_dropcreature0042.png

# Reordered animations
reorder dance 40 41 42 43 44 43 42 41
series pointing_hand 1 16 reordered 300 60 60 60 30

reorder dropcreature 42 43 44 45 46 47
series zoom-out 8 62 reordered 300 80 80 80 80 300

reorder dropcreature 42 47 46 45 44 43
series zoom-in 8 62 reordered 300 300 80 80 80 80

reorder grab 40 41 42 43 44 45 44 43 42 41
series dnd-move 5 39 reordered 60

# Animated cursors
series wait           1 12 idle  60
series pirate         0 64 slap  600 180 30
series left_ptr_watch 1 16 dance 300 30

# Static cursors
single  left_ptr    0  3 point0040
single  size_ver    8 40 holdcreature0042
single  cross      31 32 possess
single  whats_this  0 13 usedigger0041
#single  dnd-none    5 39 grab0040
single  dnd-none     2 1 holdgold0040
single  ibeam        0 0 dance0052
single  forbidden   15 8 dropcreature0046

# Rotated cursors
rotated size_hor   40 65 holdcreature0042 -90
rotated size_fdiag 30 43 holdcreature0042 -45
rotated size_bdiag  7 30 holdcreature0042  45

rotated vertical-text  0 84 dance0052  -90

# Aliases
ln -sf size_hor       right_side
ln -sf size_hor       split_h
ln -sf size_hor       sb_h_double_arrow

ln -sf size_ver       bottom_side
ln -sf size_ver       split_v
ln -sf size_ver       top_side
ln -sf size_ver       size_all
ln -sf size_ver       fleur
ln -sf size_ver       sb_v_double_arrow

ln -sf cross          crosshair
ln -sf pointing_hand  hand2
ln -sf left_ptr_watch progress
ln -sf wait           watch
ln -sf ibeam          xterm
ln -sf whats_this     question_arrow

ln -sf vertical-text  048008013003cff3c00c801001200000
ln -sf zoom-in        f41c0e382c94c0958e07017e42b00462
ln -sf zoom-out       f41c0e382c97c0938e07017e42800402
ln -sf forbidden      03b6e0fcb3499374a867c041f52298f0

# Build archive
cd /tmp/hand-of-evil
tar czf hand-of-evil.tar.gz hand-of-evil

echo "GENERATION COMPLETED
You can now install the theme with one of the following ways:
1. Using GUI, i.e. in KDE choose \"cursor theme\" from menu and install from /tmp/hand-of-evil/hand-of-evil.tar.gz
2. Manual way is to do:
   sudo mv /tmp/hand-of-evil/hand-of-evil /usr/share/icons
   sudo update-alternatives --install /usr/share/icons/default/index.theme x-cursor-theme /usr/share/icons/hand-of-evil/index.theme 200"

# Remove images
#rm *.png